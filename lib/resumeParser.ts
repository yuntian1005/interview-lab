const maxResumeFileSize = 8 * 1024 * 1024;

export async function parseResumeFile(file: File): Promise<{ text: string; file_name: string; file_type: string }> {
  if (file.size > maxResumeFileSize) {
    throw new Error("简历文件不能超过 8MB。");
  }

  const fileName = file.name || "resume";
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  let text = "";

  if (extension === "docx" || file.type.includes("wordprocessingml")) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else if (extension === "pdf" || file.type === "application/pdf") {
    try {
      const { PDFParse } = await import("pdf-parse");
      PDFParse.setWorker(resolvePdfWorkerPath());
      text = await parsePdfText(PDFParse, buffer);
    } catch (error) {
      throw new Error(pdfFallbackMessage(getErrorMessage(error)));
    }
  } else if (extension === "txt" || file.type.startsWith("text/")) {
    text = buffer.toString("utf8");
  } else {
    throw new Error("暂只支持 PDF、DOCX、TXT 格式的简历。");
  }

  const normalized = text.replace(/\r/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  if (normalized.length < 20) {
    if (extension === "pdf" || file.type === "application/pdf") {
      throw new Error(pdfFallbackMessage("PDF 中没有识别到足够的文字"));
    }

    throw new Error("简历解析出的文本过短，请换一个文件，或改用 TXT/DOCX。");
  }

  return {
    text: normalized,
    file_name: fileName,
    file_type: extension || file.type || "unknown"
  };
}

async function parsePdfText(PDFParse: typeof import("pdf-parse").PDFParse, buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: copyPdfData(buffer) });

  try {
    const result = await parser.getText();
    return result.text;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    try {
      return await parsePdfTextWithPdfJs(buffer);
    } catch (fallbackError) {
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(pdfFallbackMessage(`${message}；备用解析也失败：${fallbackMessage}`));
    }
  } finally {
    await parser.destroy();
  }
}

async function parsePdfTextWithPdfJs(buffer: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = (pdfjs.getDocument as any)({
    data: copyPdfData(buffer),
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false
  });
  const document = await loadingTask.promise;
  const pages: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item: { str?: string }) => item.str ?? "")
        .join(" ")
        .replace(/[ \t]{2,}/g, " ")
        .trim();

      if (pageText) pages.push(pageText);
    }
  } finally {
    await document.destroy();
  }

  return pages.join("\n\n");
}

function copyPdfData(buffer: Buffer): Uint8Array {
  return new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
}

function pdfFallbackMessage(reason: string): string {
  return [
    "这个 PDF 暂时无法自动识别简历文字。",
    "可能原因：PDF 是扫描件/图片版、加密文件，或文件结构不兼容。",
    "请重新上传一份可复制文字的 PDF，或把简历另存为 DOCX/TXT 后上传。",
    "也可以直接复制简历正文，粘贴到“查看/修改简历内容”里继续生成面试。",
    `错误详情：${normalizePdfErrorReason(reason)}`
  ].join("\n");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizePdfErrorReason(reason: string): string {
  if (/Object\.defineProperty called on non-object|fake worker|worker/i.test(reason)) {
    return "PDF 解析组件无法读取该文件结构。";
  }

  if (/password|encrypted/i.test(reason)) {
    return "PDF 可能被加密或需要密码。";
  }

  if (/Invalid PDF|bad XRef|xref|format/i.test(reason)) {
    return "PDF 文件结构异常或格式不兼容。";
  }

  return reason || "未知解析错误。";
}

function resolvePdfWorkerPath(): string {
  if (process.env.NODE_ENV === "production") {
    return "./pdf.worker.mjs";
  }

  return new URL("../node_modules/pdf-parse/dist/pdf-parse/esm/pdf.worker.mjs", import.meta.url).toString();
}
