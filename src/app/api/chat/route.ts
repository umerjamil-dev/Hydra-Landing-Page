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
} from "@/lib/excel";

const ollama = createOpenAICompatible({
  name: "ollama",
  baseURL: "http://localhost:11434/v1",
});

export const maxDuration = 90;

function buildDataContext(fileName: string): string {
  try {
    const { headers, rows, sheetNames } = readExcel(fileName);
    const totalRows = rows.length;

    let context = `\n\n=== EXCEL FILE DATA (RAG CONTEXT) ===\n`;
    context += `File: "${fileName}"\n`;
    context += `Sheets: ${sheetNames.join(", ")}\n`;
    context += `Columns: ${headers.join(", ")}\n`;
    context += `Total Rows: ${totalRows}\n\n`;

    // Include all data (up to 200 rows to avoid token limit)
    const dataToInclude = rows.slice(0, 200);
    context += `--- DATA START ---\n`;
    // Header row
    context += headers.join(" | ") + "\n";
    context += headers.map(() => "---").join(" | ") + "\n";
    // Data rows
    for (const row of dataToInclude) {
      const values = headers.map((h) => {
        const val = row[h];
        return val !== null && val !== undefined ? String(val) : "";
      });
      context += values.join(" | ") + "\n";
    }
    context += `--- DATA END ---\n`;

    if (totalRows > 200) {
      context += `\nNote: Showing first 200 of ${totalRows} rows. Use search tool for specific records.\n`;
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

  const systemMessage = `You are an Advanced AI Excel Manager - a highly intelligent assistant specialized in managing Excel spreadsheet data with precision and accuracy.

ROLE: You are an expert data manager. You answer questions about the spreadsheet data with 100% accuracy by referencing the actual data provided below. You NEVER guess or make up data.

${activeFile ? `Currently active file: "${activeFile}"` : "No file is currently loaded. Ask the user to upload an Excel file first."}

RULES:
1. ALWAYS answer from the ACTUAL DATA provided below. Never hallucinate or invent records.
2. When the user asks about data (e.g. "show records", "how many rows", "find X"), answer DIRECTLY from the data context below. You already have the data - use it immediately without calling tools unnecessarily.
3. Only use read_excel tool if the data might have changed (after add/update/delete operations) to get fresh data.
4. Use search_excel tool only when the data context below is truncated (200+ rows) and user needs specific records.
5. Use add_row, update_rows, delete_rows tools when user wants to MODIFY data.
6. After any modification (add/update/delete), ALWAYS use read_excel tool to get fresh data and confirm the change.
7. Present data in clean markdown tables when showing multiple records.
8. Be precise with numbers, counts, and values. Double-check your answers against the actual data.
9. If the user speaks in Urdu or Roman Urdu, respond in the same language with natural and helpful responses.
10. When asked "how many", COUNT the actual rows from the data. Do NOT estimate.
11. NEVER stop mid-response. If the output is long (like a table), continue until the entire response is complete.
12. MEMORY & CONTEXT: Pay close attention to previous messages in the conversation. If the user refers to a "previous record", "the last one", or something "discussed earlier", find it in the chat history. You are expected to have a "perfect memory" of the current session's chat history.

CRITICAL: Provide the FINAL answer to the user clearly. Do not just stop after a tool execution.

CAPABILITIES:
- Read, search, filter, analyze spreadsheet data
- Add new records
- Update existing records  
- Delete records
- Provide summaries, statistics, and insights
- Answer any question about the data accurately
${dataContext}`;

  const result = streamText({
    model: ollama.chatModel("minimax-m2:cloud"),
    system: systemMessage,
    messages: modelMessages,
    maxTokens: 4096,
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
