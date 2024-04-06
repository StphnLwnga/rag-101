import axios from "axios";
import { PDFDocument } from 'pdf-lib';
import { v4 as uuidv4 } from 'uuid';
import { writeFile, unlink } from 'fs/promises';
import { PDFLoader } from "langchain/document_loaders/fs/pdf";
import { Document } from "langchain/document";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { formatDocumentsAsString } from "langchain/util/document";
import { ChatOpenAI } from "langchain/chat_models/openai";
import { ArxivPaperNote, NOTE_PROMPT, NOTES_TOOL_SCHEMA, outputParser } from "notes/prompt.js";
import { SupabaseDatabase } from "database.js";
import { saveNotesLocally } from "notes/index.js";


console.log('Firing up the server 🔥🔥🔥');

const model = new ChatOpenAI({
  // modelName: "gpt-4-1106-preview", // Larger context window, need at least 5 dollars for this 🐩
  temperature: 0.0,
});

export interface MainProps {
  paperUrl: string;
  paperName: string;
  pagesToDelete?: Array<number>;
}

/**
 * Asynchronously loads a PDF from a given URL.
 *
 * @param {string} url - The URL from which to load the PDF.
 * @return {Promise<Buffer>} A Promise that resolves to a Buffer containing the PDF data.
 */
async function loadPdfFromUrl({ url }: { url: string; }): Promise<Buffer> {
  try {
    console.log("Loading PDF from URL...");
    const response = await axios.get(url, { responseType: "arraybuffer", });
    console.log("PDF loaded successfully 📜📜📜");
    return response.data;
  } catch (error) {
    console.log(error);
    throw new Error("PDF fetching failed 🩻");
  }
}

/**
 * Deletes specific pages from a PDF buffer and returns the updated PDF buffer.
 *
 * @param {Buffer} pdf - The original PDF buffer
 * @param {Array<number>} pagesToDelete - An array of page numbers to delete from the PDF
 * @return {Promise<Buffer>} A Promise that resolves to the updated PDF buffer
 */
async function deletePages(pdf: Buffer, pagesToDelete: Array<number>): Promise<Buffer> {
  try {
    const pdfDoc = await PDFDocument.load(pdf);

    let numToOffsetBy = 1;
    for (const pageNumber of pagesToDelete) {
      pdfDoc.removePage(pageNumber - numToOffsetBy);
      numToOffsetBy += 1;
    }
    console.log('Pages deleted successfully 🗑️');
    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  } catch (error) {
    console.log(error);
    throw new Error("Failed to delete pages 🩻");
  }
}

/**
 * Converts a PDF buffer to an array of documents.
 *
 * @param {Buffer} pdf - The PDF buffer to convert.
 * @return {Promise<Array<Document>>} A promise that resolves to an array of documents.
 */
async function convertPdfToDocuments(pdf: Buffer): Promise<Array<Document>> {
  try {
    // create file name for each Document created from the PDF using UUIDv4
    const fileName = uuidv4().substring(0, 13);
    const pdfPath = `pdfs/${fileName}.pdf`;
    // Save Document to file
    await writeFile(pdfPath, pdf, "binary");

    const loader = new PDFLoader(pdfPath);
    /* // create Unstructured loader if Unstructured API key is provided
    const loader = new UnstructuredLoader(pdfPath, {
      apiKey: process.env.UNSTRUCTURED_API_KEY,
      strategy: "hi_res",
    });
    */

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });
    const docs = await loader.loadAndSplit(splitter);

    /* // delete temporary PDF file if using Unstructured loader
    await unlink(pdfPath);
    */

    console.log("PDF converted successfully 🔀🔀");

    return docs;
  } catch (error) {
    console.log(error);
    throw new Error("PDF to Document conversion failed 🩻");
  }
}


/**
 * Generate notes based on the provided documents.
 *
 * @param {Array<Document>} documents - array of documents
 * @return {Promise<any>} the result of generating notes
 */
async function generateNotes(url:string, documents: Array<Document>): Promise<Array<ArxivPaperNote>> {
  try {
    const documentAsStr = formatDocumentsAsString(documents);

    const modelWithTool = model.bind({
      tools: [NOTES_TOOL_SCHEMA],
    });

    const chain = NOTE_PROMPT.pipe(modelWithTool).pipe(outputParser);

    const notes =  await chain.invoke({ paper: documentAsStr });
    
    // Save notes locally
    saveNotesLocally(url, notes);

    return notes;
  } catch (error) {
    console.log(error);
    throw new Error("Notes generation failed 🩻");
  }
}

/**
 * Function to process a paper by validating the URL, loading the paper, deleting pages if any, 
 * converting the PDF to documents, adding metadata, generating notes, creating a database, 
 * adding paper to the database, and adding documents to the vector store.
 *
 * @param {MainProps} paperUrl - The URL of the paper to be processed
 * @param {string} paperName - The name of the paper
 * @param {number[]} pagesToDelete - An array of page numbers to delete from the paper
 * @return {Promise<Array<ArxivPaperNote>>} A promise that resolves to an array of notes generated from the processed paper
 */
export async function main({ paperUrl, paperName, pagesToDelete }: MainProps): Promise<Array<ArxivPaperNote>> {
  try {
    // Validate paper URL
    if (!paperUrl.endsWith(".pdf"))
      throw new Error("Invalid paper URL");

    // Load paper from URL as buffer
    let pdfAsBuffer = await loadPdfFromUrl({ url: paperUrl });

    // Delete pages if any
    if (pagesToDelete && pagesToDelete.length > 0)
      pdfAsBuffer = await deletePages(pdfAsBuffer, pagesToDelete);

    // Convert PDF to documents
    const documents = await convertPdfToDocuments(pdfAsBuffer);

    // Add metadata to each document
    const formattedDocs: Array<Document> = documents.map(doc => ({
      ...doc,
      metadata: {
        ...doc.metadata,
        url: paperUrl,
      },
    }));

    // Generate notes from the documents
    const notes = await generateNotes(paperUrl, documents);

    // Create Supabase database
    const database = await SupabaseDatabase.fromDocuments(formattedDocs);

    // Add paper to Supabase & add documents to the vector store
    await Promise.all([
      database.addPaper({
        paper: formatDocumentsAsString(formattedDocs),
        url: paperUrl,
        name: paperName,
        notes,
      }),
      database.vectorStore.addDocuments(formattedDocs),
    ]);

    return notes;
  } catch (error) {
    console.log(error);
    throw new Error(`AI minus the braids 🩻`,);
  }
};
