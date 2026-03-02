import { streamText, tool, stepCountIs, convertToModelMessages } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import {
  readExcel,
  searchExcel,
  searchAllColumns,
  searchEveryFile,
  addRow,
  deleteRows,
  updateRows,
  getUploadedFiles,
  getExcelMetadata,
  getColumnValues,
} from "@/lib/excel";

const ollama = createOpenAICompatible({
  name: "ollama",
  baseURL: "http://localhost:11434/v1",
});

export const maxDuration = 90;

async function buildDataContext(fileName: string): Promise<string> {
  try {
    const { headers, rows, sheetNames } = await readExcel(fileName);
    const meta = await getExcelMetadata(fileName);
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
  const dataContext = activeFile ? await buildDataContext(activeFile) : "";

  const systemMessage = `You are an Advanced AI Excel Manager with a Smart RAG system for 100% accuracy.

ROLE: Expert Data Auditor & Manager. Your primary goal is precision. You can READ, SEARCH, ADD, UPDATE, and DELETE records in the Excel file.

CORE REASONING ENGINE (SMART RAG):
1. EXPLORE FIRST: Use 'get_excel_metadata' to see columns. Use 'get_column_values' for categorical data.
2. QUERY PLANNING:
   - READ TOOL OUTPUT CAREFULLY: If a tool returns 'Updated 0 row(s)', do NOT say "Done". Instead, say the record was not found or the criteria didn't match.
   - SEARCH BEFORE WRITE: Before calling 'update_rows' or 'delete_rows', ALWAYS use 'search_all_columns' to find the exact row and confirm column names.
   - PARTIAL MATCHES: For domains or names, use matchType: "contains" unless you are 100% sure of the exact value.
3. CONCISENESS & FOCUS: 
   - When a user searches for a specific value (like a domain), ONLY talk about that match. 
   - Do NOT list all other columns in the row if they contain unrelated data (like other different domains) unless the user asks for "all details" or "full row".
   - If "siautojapan.com" is in the "Hostinger" column, just say that. Don't mention what's in the "Server" or "Adnan" columns if they contain different, unrelated domains.
4. VERIFY-BEFORE-RESPOND: After updating/deleting, you can call 'search_excel' again to double-check the change for the user.
5. ZERO HALLUCINATION: If search fails, state it clearly. Do not pretend to have made changes if the tool reported 0 updates.

RULES:
1. ALWAYS answer from actual data. 
2. Use markdown tables for multiple records.
3. Match language: If the user asks in Urdu or Roman Urdu (e.g., "is kah bat kuch boltah hi nhi"), respond in the same language with clear, helpful details.
4. MEMORY: Keep track of the entire conversation.
5. WRITING: You are empowered to make changes. When a user asks to add/update/delete, do it immediately using the correct tool.

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
            const data = await readExcel(activeFile, sheetName);
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
          "Search for specific records in the Excel file by column value.",
        inputSchema: z.object({
          column: z.string().describe("The column name to search in"),
          query: z.string().describe("The search query to look for"),
          sheetName: z.string().optional().describe("Name of the sheet to search in"),
          matchType: z
            .enum(["exact", "contains"])
            .default("contains")
            .describe("Whether to look for an exact match or if the value contains the query."),
        }),
        execute: async ({ column, query, sheetName, matchType }) => {
          if (!activeFile) return { error: "No file loaded. Please upload a file first." };
          try {
            const results = await searchExcel(activeFile, column, query, sheetName, matchType);
            return {
              query: { column, value: query, matchType },
              matchCount: results.length,
              results: results.slice(0, 50),
            };
          } catch (e) {
            return { error: e instanceof Error ? e.message : "Search failed" };
          }
        },
      }),
      search_all_columns: tool({
        description:
          "Search for a query across ALL columns in the active Excel file. Use this when you are not sure which column contains the information.",
        inputSchema: z.object({
          query: z.string().describe("The search query to look for"),
          sheetName: z.string().optional().describe("Name of the sheet to search in"),
        }),
        execute: async ({ query, sheetName }) => {
          if (!activeFile) return { error: "No file loaded. Please upload a file first." };
          try {
            const results = await searchAllColumns(activeFile, query, sheetName);
            return {
              query,
              matchCount: results.length,
              results: results.slice(0, 50),
            };
          } catch (e) {
            return { error: e instanceof Error ? e.message : "Global search failed" };
          }
        },
      }),
      search_every_file: tool({
        description: "Search for a query across ALL uploaded Excel files and ALL sheets/columns. Use this if the data is not found in the active file.",
        inputSchema: z.object({
          query: z.string().describe("The search query to look for"),
        }),
        execute: async ({ query }) => {
          try {
            const results = await searchEveryFile(query);
            return { query, results };
          } catch (e) {
            return { error: e instanceof Error ? e.message : "Cross-file search failed" };
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
            const result = await addRow(activeFile, rowData, sheetName);
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
          matchType: z
            .enum(["exact", "contains"])
            .default("exact")
            .describe("Whether to match the search value exactly or if it contains it."),
        }),
        execute: async ({ searchColumn, searchValue, updates, sheetName, matchType }) => {
          if (!activeFile) return { error: "No file loaded. Please upload a file first." };
          try {
            const result = await updateRows(
              activeFile,
              searchColumn,
              searchValue,
              updates,
              sheetName,
              matchType
            );
            if (result.updatedCount === 0) {
              return {
                error: `No rows found matching '${searchValue}' in column '${searchColumn}'. No changes were made.`,
                criteria: { column: searchColumn, value: searchValue, matchType },
              };
            }
            return {
              message: `Successfully updated ${result.updatedCount} row(s)`,
              updatedCount: result.updatedCount,
              criteria: { column: searchColumn, value: searchValue, matchType },
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
          matchType: z
            .enum(["exact", "contains"])
            .default("exact")
            .describe("Whether to match the value exactly or if it contains it."),
        }),
        execute: async ({ column, value, sheetName, matchType }) => {
          if (!activeFile) return { error: "No file loaded. Please upload a file first." };
          try {
            const result = await deleteRows(activeFile, column, value, sheetName, matchType);
            if (result.deletedCount === 0) {
              return {
                error: `No rows found matching '${value}' in column '${column}'. Nothing was deleted.`,
                criteria: { column, value, matchType },
              };
            }
            return {
              message: `Successfully deleted ${result.deletedCount} row(s)`,
              deletedCount: result.deletedCount,
              totalRowsRemaining: result.totalRows,
              criteria: { column, value, matchType },
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
      get_column_values: tool({
        description: "Get all unique values and their counts for a specific column.",
        inputSchema: z.object({
          column: z.string().describe("The column name to get values for"),
          sheetName: z.string().optional().describe("Name of the sheet"),
        }),
        execute: async ({ column, sheetName }) => {
          if (!activeFile) return { error: "No file loaded. Please upload a file first." };
          try {
            const results = await getColumnValues(activeFile, column, sheetName);
            return results;
          } catch (e) {
            return { error: e instanceof Error ? e.message : "Failed to get column values" };
          }
        },
      }),
    },
    stopWhen: stepCountIs(10),
  });

  return result.toUIMessageStreamResponse();
}
