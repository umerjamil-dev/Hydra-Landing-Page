import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

function getFilePath(fileName: string): string {
  // Sanitize filename to prevent path traversal
  const sanitized = path.basename(fileName);
  return path.join(UPLOADS_DIR, sanitized);
}

export function getUploadedFiles(): string[] {
  if (!fs.existsSync(UPLOADS_DIR)) return [];
  return fs
    .readdirSync(UPLOADS_DIR)
    .filter((f) => f.endsWith(".xlsx") || f.endsWith(".xls") || f.endsWith(".csv"));
}

export function readExcel(
  fileName: string,
  sheetName?: string
): { headers: string[]; rows: Record<string, unknown>[]; sheetNames: string[] } {
  const filePath = getFilePath(fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`File "${fileName}" not found`);
  }
  const fileBuffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(fileBuffer);
  const targetSheet = sheetName || workbook.SheetNames[0];
  const worksheet = workbook.Sheets[targetSheet];
  if (!worksheet) {
    throw new Error(
      `Sheet "${targetSheet}" not found. Available sheets: ${workbook.SheetNames.join(", ")}`
    );
  }
  const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);
  const headers =
    jsonData.length > 0 ? Object.keys(jsonData[0]) : [];
  return { headers, rows: jsonData, sheetNames: workbook.SheetNames };
}

export function searchExcel(
  fileName: string,
  column: string,
  query: string,
  sheetName?: string
): Record<string, unknown>[] {
  const { rows } = readExcel(fileName, sheetName);
  const lowerQuery = query.toLowerCase();
  return rows.filter((row) => {
    const val = row[column];
    if (val === null || val === undefined) return false;
    return String(val).toLowerCase().includes(lowerQuery);
  });
}

export function addRow(
  fileName: string,
  rowData: Record<string, unknown>,
  sheetName?: string
): { success: boolean; totalRows: number } {
  const filePath = getFilePath(fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`File "${fileName}" not found`);
  }
  const fileBuffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(fileBuffer);
  const targetSheet = sheetName || workbook.SheetNames[0];
  const worksheet = workbook.Sheets[targetSheet];
  if (!worksheet) {
    throw new Error(`Sheet "${targetSheet}" not found`);
  }
  const existingData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);
  existingData.push(rowData);
  const newWorksheet = XLSX.utils.json_to_sheet(existingData);
  workbook.Sheets[targetSheet] = newWorksheet;
  const writeBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  fs.writeFileSync(filePath, writeBuffer);
  return { success: true, totalRows: existingData.length };
}

export function deleteRows(
  fileName: string,
  column: string,
  value: string,
  sheetName?: string
): { success: boolean; deletedCount: number; totalRows: number } {
  const filePath = getFilePath(fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`File "${fileName}" not found`);
  }
  const fileBuffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(fileBuffer);
  const targetSheet = sheetName || workbook.SheetNames[0];
  const worksheet = workbook.Sheets[targetSheet];
  if (!worksheet) {
    throw new Error(`Sheet "${targetSheet}" not found`);
  }
  const existingData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);
  const lowerValue = value.toLowerCase();
  const filtered = existingData.filter((row) => {
    const val = row[column];
    if (val === null || val === undefined) return true;
    return !String(val).toLowerCase().includes(lowerValue);
  });
  const deletedCount = existingData.length - filtered.length;
  const newWorksheet = XLSX.utils.json_to_sheet(filtered);
  workbook.Sheets[targetSheet] = newWorksheet;
  const writeBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  fs.writeFileSync(filePath, writeBuffer);
  return { success: true, deletedCount, totalRows: filtered.length };
}

export function updateRows(
  fileName: string,
  searchColumn: string,
  searchValue: string,
  updates: Record<string, unknown>,
  sheetName?: string
): { success: boolean; updatedCount: number } {
  const filePath = getFilePath(fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`File "${fileName}" not found`);
  }
  const fileBuffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(fileBuffer);
  const targetSheet = sheetName || workbook.SheetNames[0];
  const worksheet = workbook.Sheets[targetSheet];
  if (!worksheet) {
    throw new Error(`Sheet "${targetSheet}" not found`);
  }
  const existingData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);
  const lowerValue = searchValue.toLowerCase();
  let updatedCount = 0;
  for (const row of existingData) {
    const val = row[searchColumn];
    if (val !== null && val !== undefined && String(val).toLowerCase().includes(lowerValue)) {
      Object.assign(row, updates);
      updatedCount++;
    }
  }
  const newWorksheet = XLSX.utils.json_to_sheet(existingData);
  workbook.Sheets[targetSheet] = newWorksheet;
  const writeBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  fs.writeFileSync(filePath, writeBuffer);
  return { success: true, updatedCount };
}

export function getExcelMetadata(
  fileName: string,
  sheetName?: string
): {
  rowCount: number;
  columnDetails: Record<string, { type: string; uniqueValues: string[]; count: number }>;
} {
  const { rows, headers } = readExcel(fileName, sheetName);
  const rowCount = rows.length;
  const columnDetails: Record<string, { type: string; uniqueValues: string[]; count: number }> = {};

  for (const header of headers) {
    const values = rows.map((r) => r[header]).filter((v) => v !== null && v !== undefined);
    const uniqueVals = Array.from(new Set(values.map((v) => String(v))));

    // Detect type
    let type = "string";
    if (values.length > 0) {
      const firstVal = values[0];
      if (typeof firstVal === "number") type = "number";
      else if (firstVal instanceof Date) type = "date";
      else if (typeof firstVal === "boolean") type = "boolean";
    }

    columnDetails[header] = {
      type,
      uniqueValues: uniqueVals.slice(0, 15), // Sample first 15 unique values
      count: uniqueVals.length,
    };
  }

  return { rowCount, columnDetails };
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
