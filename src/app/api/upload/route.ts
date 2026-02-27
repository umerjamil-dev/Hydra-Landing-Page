import { NextRequest, NextResponse } from "next/server";
import { saveUploadedFile, getUploadedFiles, readExcel } from "@/lib/excel";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext || !["xlsx", "xls", "csv"].includes(ext)) {
      return NextResponse.json(
        { error: "Only .xlsx, .xls, .csv files are supported" },
        { status: 400 }
      );
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const savedName = saveUploadedFile(buffer, file.name);
    const { headers, rows, sheetNames } = readExcel(savedName);
    return NextResponse.json({
      fileName: savedName,
      sheetNames,
      headers,
      rowCount: rows.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  const files = getUploadedFiles();
  return NextResponse.json({ files });
}
