import { streamText, tool, stepCountIs, convertToModelMessages } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import {
  readExcel,
  searchExcel,
  addRow,
  deleteRows,
  updateRows,
  getUploadedFiles,
  getExcelMetadata,
} from "@/lib/excel";

const ollama = createOpenAICompatible({
  name: "ollama",
  baseURL: "http://localhost:11434/v1",
});

export const maxDuration = 90;

function buildDataContext(fileName: string): string {
  try {
    const { headers, rows, sheetNames } = readExcel(fileName);
    const meta = getExcelMetadata(fileName);
    const totalRows = rows.length;

    let context = `\n\n=== EXCEL MICRO-METADATA (STRUCTURAL INSIGHTS) ===\n`;
    context += `File: "${fileName}" | Total Rows: ${totalRows}\n`;
    context += `Sheets: ${sheetNames.join(", ")}\n\n`;

    context += `COLUMN INSIGHTS:\n`;
    for (const [col, details] of Object.entries(meta.columnDetails)) {
      context += `- [${col}] (${details.type}): ${details.count} unique values. Sample: ${details.uniqueValues.join(", ")}${details.count > 15 ? "..." : ""}\n`;
    }

    context += `\n=== SAMPLE DATA (FIRST 100 ROWS) ===\n`;
    // Include first 100 rows for context
    const dataToInclude = rows.slice(0, 100);
    context += headers.join(" | ") + "\n";
    context += headers.map(() => "---").join(" | ") + "\n";
    for (const row of dataToInclude) {
      const values = headers.map((h) => String(row[h] ?? ""));
      context += values.join(" | ") + "\n";
    }

    if (totalRows > 100) {
      context += `\nNote: Data context truncated at 100 rows. ALWAYS use 'search_excel' for files with ${totalRows} rows if checking beyond row 100.\n`;
    }

    return context;
  } catch {
    return "\n\nCould not load file data.\n";
  }
}

export async function POST(req: Request) {
  const { messages: rawMessages, fileName } = await req.json();

  const activeFile = fileName || getUploadedFiles()[0] || null;

  const modelMessages = await convertToModelMessages(rawMessages);

  // Build RAG context from Excel data
  const dataContext = activeFile ? buildDataContext(activeFile) : "";

  const systemMessage = `You are an Advanced AI Excel Manager with a Smart RAG system for 100% accuracy.

ROLE: Expert Data Auditor & Manager. Your primary goal is precision. 

CORE REASONING ENGINE (SMART RAG):
1. READ METADATA FIRST: Review the "EXCEL MICRO-METADATA" to understand column names, data types, and unique value samples.
2. QUERY PLANNING:
   - If a question asks for a specific record (e.g., "Find Ahmad"), use 'search_excel' ONLY IF the record isn't in the provided SAMPLE DATA.
   - If a question asks for a count or summary (e.g., "Total sales in Lahore"), use 'search_excel' to find all relevant records if the total rows > 100.
3. VERIFY-BEFORE-RESPOND: After getting data (via context or tool), double-check your count and values against the data. Do NOT estimate.
4. ZERO HALLUCINATION: If the data isn't in the context or search results, state clearly that it is not found.

RULES:
1. ALWAYS answer from actual data. 
2. Use markdown tables for multiple records.
3. Match language: If Urdu/Roman Urdu is used, respond naturally in the same language.
4. MEMORY: Keep track of the entire conversation.
5. NO TRUNCATION: Complete every response fully.

${activeFile ? `Currently active file: "${activeFile}"` : "No file is currently loaded."}

${dataContext}`;

  const result = streamText({
    model: ollama.chatModel("minimax-m2:cloud"),
    system: systemMessage,
    messages: modelMessages,
    tools: {
      read_excel: tool({
        description:
          "Read fresh data from the Excel file. Use this ONLY after data has been modified (add/update/delete) to get updated data, or if you need to verify current state.",
        inputSchema: z.object({
          sheetName: z
            .string()
            .optional()
            .describe("Name of the sheet to read. If not provided, reads the first sheet."),
        }),
        execute: async ({ sheetName }) => {
          if (!activeFile) return { error: "No file loaded. Please upload a file first." };
          try {
            const data = readExcel(activeFile, sheetName);
            const preview = data.rows.slice(0, 50);
            return {
              fileName: activeFile,
              sheetNames: data.sheetNames,
              headers: data.headers,
              totalRows: data.rows.length,
              preview,
              note:
                data.rows.length > 50
                  ? `Showing first 50 of ${data.rows.length} rows. Use search to find specific records.`
                  : undefined,
            };
          } catch (e) {
            return { error: e instanceof Error ? e.message : "Failed to read file" };
          }
        },
      }),
      search_excel: tool({
        description:
          "Search for specific records in the Excel file by column value. Use when the dataset is large (200+ rows) and you need to find specific records.",
        inputSchema: z.object({
          column: z.string().describe("The column name to search in"),
          query: z.string().describe("The search query to look for"),
          sheetName: z.string().optional().describe("Name of the sheet to search in"),
        }),
        execute: async ({ column, query, sheetName }) => {
          if (!activeFile) return { error: "No file loaded. Please upload a file first." };
          try {
            const results = searchExcel(activeFile, column, query, sheetName);
            return {
              query: { column, value: query },
              matchCount: results.length,
              results: results.slice(0, 50),
            };
          } catch (e) {
            return { error: e instanceof Error ? e.message : "Search failed" };
          }
        },
      }),
      add_row: tool({
        description:
          "Add a new row/record to the Excel file. Use when the user wants to add new data. Make sure column names match exactly.",
        inputSchema: z.object({
          rowData: z
            .record(z.string(), z.unknown())
            .describe(
              "The data for the new row as key-value pairs where keys are column names"
            ),
          sheetName: z.string().optional().describe("Name of the sheet to add to"),
        }),
        execute: async ({ rowData, sheetName }) => {
          if (!activeFile) return { error: "No file loaded. Please upload a file first." };
          try {
            const result = addRow(activeFile, rowData, sheetName);
            return {
              message: "Row added successfully",
              totalRows: result.totalRows,
              addedData: rowData,
            };
          } catch (e) {
            return { error: e instanceof Error ? e.message : "Failed to add row" };
          }
        },
      }),
      update_rows: tool({
        description:
          "Update existing rows in the Excel file. Finds rows where a column matches a value and applies updates.",
        inputSchema: z.object({
          searchColumn: z.string().describe("The column name to search in for matching rows"),
          searchValue: z.string().describe("The value to match"),
          updates: z
            .record(z.string(), z.unknown())
            .describe("Key-value pairs of columns and new values to update"),
          sheetName: z.string().optional().describe("Name of the sheet"),
        }),
        execute: async ({ searchColumn, searchValue, updates, sheetName }) => {
          if (!activeFile) return { error: "No file loaded. Please upload a file first." };
          try {
            const result = updateRows(activeFile, searchColumn, searchValue, updates, sheetName);
            return {
              message: `Updated ${result.updatedCount} row(s)`,
              updatedCount: result.updatedCount,
              criteria: { column: searchColumn, value: searchValue },
              appliedUpdates: updates,
            };
          } catch (e) {
            return { error: e instanceof Error ? e.message : "Failed to update" };
          }
        },
      }),
      delete_rows: tool({
        description:
          "Delete rows from the Excel file where a column matches a value.",
        inputSchema: z.object({
          column: z.string().describe("The column name to match for deletion"),
          value: z.string().describe("The value to match for deletion"),
          sheetName: z.string().optional().describe("Name of the sheet"),
        }),
        execute: async ({ column, value, sheetName }) => {
          if (!activeFile) return { error: "No file loaded. Please upload a file first." };
          try {
            const result = deleteRows(activeFile, column, value, sheetName);
            return {
              message: `Deleted ${result.deletedCount} row(s)`,
              deletedCount: result.deletedCount,
              totalRowsRemaining: result.totalRows,
            };
          } catch (e) {
            return { error: e instanceof Error ? e.message : "Failed to delete" };
          }
        },
      }),
      list_files: tool({
        description: "List all uploaded Excel files.",
        inputSchema: z.object({}),
        execute: async () => {
          const files = getUploadedFiles();
          return { files, count: files.length };
        },
      }),
    },
    stopWhen: stepCountIs(10),
  });

  return result.toUIMessageStreamResponse();
}
