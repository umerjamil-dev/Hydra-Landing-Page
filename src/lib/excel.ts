import * as ExcelJS from "exceljs";
import * as fs from "fs";
import * as path from "path";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

function getFilePath(fileName: string): string {
  const sanitized = path.basename(fileName);
  return path.join(UPLOADS_DIR, sanitized);
}

export function getUploadedFiles(): string[] {
  if (!fs.existsSync(UPLOADS_DIR)) return [];
  return fs
    .readdirSync(UPLOADS_DIR)
    .filter((f) => f.endsWith(".xlsx") || f.endsWith(".xls") || f.endsWith(".csv"));
}

/**
 * Helper to get rows and headers using ExcelJS
 */
async function getExcelData(fileName: string, sheetName?: string) {
  const filePath = getFilePath(fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`File "${fileName}" not found`);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0];

  if (!worksheet) {
    throw new Error(`Sheet "${sheetName}" not found`);
  }

  const rows: Record<string, any>[] = [];
  const headers: string[] = [];

  // 1. Find the first row that has data to use as Header Row
  let headerRowIndex = 1;
  const totalRows = worksheet.rowCount;
  
  for (let i = 1; i <= totalRows; i++) {
    const row = worksheet.getRow(i);
    let hasData = false;
    row.eachCell({ includeEmpty: false }, () => { hasData = true; });
    if (hasData) {
      headerRowIndex = i;
      break;
    }
  }

  // 2. Extract headers from the detected Header Row
  const headerRow = worksheet.getRow(headerRowIndex);
  const colCount = worksheet.columnCount;
  
  for (let i = 1; i <= colCount; i++) {
    const cell = headerRow.getCell(i);
    const value = cell.value;
    let headerName = "";
    if (value && typeof value === "object" && "result" in value) {
      headerName = String(value.result ?? "");
    } else if (value && typeof value === "object" && "richText" in value) {
      headerName = (value as any).richText.map((rt: any) => rt.text).join("");
    } else {
      headerName = value ? String(value) : "";
    }
    
    const finalHeader = headerName.trim() || `Column${i}`;
    headers.push(finalHeader);
  }

  // 3. Get data rows from headerRowIndex + 1 to totalRows
  for (let i = headerRowIndex + 1; i <= totalRows; i++) {
    const row = worksheet.getRow(i);
    const rowData: Record<string, any> = {};
    let hasData = false;
    
    headers.forEach((header, index) => {
      const cell = row.getCell(index + 1);
      let val: any = cell.value;
      
      // Extract result from formulas, rich text, or links
      if (val && typeof val === "object") {
        if ("result" in val) {
          val = val.result;
        } else if ("richText" in val) {
          val = (val as any).richText.map((rt: any) => rt.text).join("");
        } else if ("text" in val && "hyperlink" in val) {
          val = val.text;
        } else if (val instanceof Date) {
          // Keep as is, it's a date
        } else {
          // Attempt to stringify other objects if unknown
          // val = JSON.stringify(val);
        }
      }
      
      rowData[header] = val;
      if (val !== null && val !== undefined && val !== "") hasData = true;
    });
    
    // Push even empty rows if they are within the actual populated range
    // to maintain a true "Excel" look, or only pushed if hasData
    if (hasData) {
      rows.push(rowData);
    }
  }

  return { workbook, worksheet, headers, rows, sheetNames: workbook.worksheets.map(ws => ws.name) };
}

export async function readExcel(
  fileName: string,
  sheetName?: string
): Promise<{ headers: string[]; rows: Record<string, any>[]; sheetNames: string[] }> {
  const { headers, rows, sheetNames } = await getExcelData(fileName, sheetName);
  return { headers, rows, sheetNames };
}

export async function searchExcel(
  fileName: string,
  column: string,
  query: string,
  sheetName?: string,
  matchType: "exact" | "contains" = "contains"
): Promise<Record<string, any>[]> {
  const { rows } = await getExcelData(fileName, sheetName);
  const lowerQuery = query.toLowerCase();
  return rows.filter((row) => {
    const val = row[column];
    if (val === null || val === undefined) return false;
    const stringVal = String(val).toLowerCase();
    return matchType === "exact" ? stringVal === lowerQuery : stringVal.includes(lowerQuery);
  });
}

export async function searchAllColumns(
  fileName: string,
  query: string,
  sheetName?: string
): Promise<Record<string, any>[]> {
  const { rows, headers } = await getExcelData(fileName, sheetName);
  const lowerQuery = query.toLowerCase();
  return rows.filter((row) => {
    return headers.some((header) => {
      const val = row[header];
      if (val === null || val === undefined) return false;
      return String(val).toLowerCase().includes(lowerQuery);
    });
  });
}

export async function searchEveryFile(query: string): Promise<{ fileName: string; sheetName: string; results: Record<string, any>[] }[]> {
  const files = getUploadedFiles();
  const allResults: { fileName: string; sheetName: string; results: Record<string, any>[] }[] = [];

  for (const file of files) {
    try {
      const { rows, headers, sheetNames } = await getExcelData(file);
      for (const sheet of sheetNames) {
        const { rows: sheetRows, headers: sheetHeaders } = await getExcelData(file, sheet);
        const matches = sheetRows.filter((row) => {
          return sheetHeaders.some((header) => {
            const val = row[header];
            if (val === null || val === undefined) return false;
            return String(val).toLowerCase().includes(query.toLowerCase());
          });
        });

        if (matches.length > 0) {
          allResults.push({ fileName: file, sheetName: sheet, results: matches });
        }
      }
    } catch (e) {
      console.error(`Error searching file ${file}:`, e);
    }
  }
  return allResults;
}

export async function addRow(
  fileName: string,
  rowData: Record<string, any>,
  sheetName?: string
): Promise<{ success: boolean; totalRows: number }> {
  const { workbook, worksheet, headers } = await getExcelData(fileName, sheetName);
  
  const newRowValues = headers.map(h => rowData[h] ?? null);
  worksheet.addRow(newRowValues);
  
  const filePath = getFilePath(fileName);
  await workbook.xlsx.writeFile(filePath);
  
  return { success: true, totalRows: worksheet.rowCount - 1 };
}

export async function deleteRows(
  fileName: string,
  column: string,
  value: string,
  sheetName?: string,
  matchType: "exact" | "contains" = "exact"
): Promise<{ success: boolean; deletedCount: number; totalRows: number }> {
  const { workbook, worksheet, headers } = await getExcelData(fileName, sheetName);
  const colIndex = headers.indexOf(column) + 1;
  const lowerValue = value.toLowerCase();

  let deletedCount = 0;
  // Iterate backwards to avoid index shifts during deletion
  for (let i = worksheet.rowCount; i >= 2; i--) {
    const row = worksheet.getRow(i);
    const cellValue = row.getCell(colIndex).value;
    if (cellValue !== null && cellValue !== undefined) {
      const stringVal = String(cellValue).toLowerCase();
      const isMatch = matchType === "exact" ? stringVal === lowerValue : stringVal.includes(lowerValue);
      if (isMatch) {
        worksheet.spliceRows(i, 1);
        deletedCount++;
      }
    }
  }

  if (deletedCount > 0) {
    const filePath = getFilePath(fileName);
    await workbook.xlsx.writeFile(filePath);
  }

  return { success: true, deletedCount, totalRows: worksheet.rowCount - 1 };
}

export async function updateRows(
  fileName: string,
  searchColumn: string,
  searchValue: string,
  updates: Record<string, any>,
  sheetName?: string,
  matchType: "exact" | "contains" = "exact"
): Promise<{ success: boolean; updatedCount: number }> {
  const { workbook, worksheet, headers } = await getExcelData(fileName, sheetName);
  const searchColIndex = headers.indexOf(searchColumn) + 1;
  const lowerValue = searchValue.toLowerCase();

  let updatedCount = 0;
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const cellValue = row.getCell(searchColIndex).value;
    if (cellValue !== null && cellValue !== undefined) {
      const stringVal = String(cellValue).toLowerCase();
      const isMatch = matchType === "exact" ? stringVal === lowerValue : stringVal.includes(lowerValue);
      if (isMatch) {
        Object.entries(updates).forEach(([colName, newVal]) => {
          const updateColIndex = headers.indexOf(colName) + 1;
          if (updateColIndex > 0) {
            row.getCell(updateColIndex).value = newVal as any;
          }
        });
        updatedCount++;
      }
    }
  });

  if (updatedCount > 0) {
    const filePath = getFilePath(fileName);
    await workbook.xlsx.writeFile(filePath);
  }

  return { success: true, updatedCount };
}

export async function getExcelMetadata(
  fileName: string,
  sheetName?: string
): Promise<{
  rowCount: number;
  columnDetails: Record<string, { type: string; uniqueValues: string[]; count: number }>;
}> {
  const { rows, headers } = await getExcelData(fileName, sheetName);
  const rowCount = rows.length;
  const columnDetails: Record<string, { type: string; uniqueValues: string[]; count: number }> = {};

  for (const header of headers) {
    const values = rows.map((r) => r[header]).filter((v) => v !== null && v !== undefined);
    const uniqueVals = Array.from(new Set(values.map((v) => String(v))));

    let type = "string";
    if (values.length > 0) {
      const firstVal = values[0];
      if (typeof firstVal === "number") type = "number";
      else if (firstVal instanceof Date) type = "date";
      else if (typeof firstVal === "boolean") type = "boolean";
    }

    columnDetails[header] = {
      type,
      uniqueValues: uniqueVals.slice(0, 15),
      count: uniqueVals.length,
    };
  }

  return { rowCount, columnDetails };
}

export async function getColumnValues(
  fileName: string,
  column: string,
  sheetName?: string
): Promise<{ column: string; uniqueValues: { value: string; count: number }[]; totalUnique: number }> {
  const { rows } = await getExcelData(fileName, sheetName);
  const valueCounts: Record<string, number> = {};

  for (const row of rows) {
    const val = String(row[column] ?? "EMPTY");
    valueCounts[val] = (valueCounts[val] || 0) + 1;
  }

  const uniqueValues = Object.entries(valueCounts)
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);

  return {
    column,
    uniqueValues: uniqueValues.slice(0, 100),
    totalUnique: uniqueValues.length,
  };
}

export function saveUploadedFile(buffer: Buffer, fileName: string): string {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  const sanitized = path.basename(fileName);
  const filePath = path.join(UPLOADS_DIR, sanitized);
  fs.writeFileSync(filePath, buffer);
  return sanitized;
}
