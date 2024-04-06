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
import { HNSWDatabase, saveToLocalStorage } from "hnsw-store.js";
import * as fs from 'fs';
import path from 'path';


console.log('Firing up the server 🔥🔥🔥');

export const model = new ChatOpenAI({
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
 * Loads a PDF document from the specified path.
 *
 * @param {string} path - The path to the PDF file.
 * @return {Promise<PDFDocument | string>} The loaded PDF document or error meesage if the file is not found or an error occurs.
 */
async function loadPdfFromPath({ path }: { path: string }) {
  try {
    return fs.readFileSync(path);
  } catch (error) {
    console.log(error);
    return 'File not found!';
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

    // delete temporary PDF file 
    await unlink(pdfPath);

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
async function generateNotes(url: string, documents: Array<Document>): Promise<Array<ArxivPaperNote>> {
  try {
    const documentAsStr = formatDocumentsAsString(documents);

    const modelWithTool = model.bind({
      tools: [NOTES_TOOL_SCHEMA],
    });

    const chain = NOTE_PROMPT.pipe(modelWithTool).pipe(outputParser);

    const notes = await chain.invoke({ paper: documentAsStr });

    // Save notes locally
    // saveNotesLocally(url, notes);

    return notes;
  } catch (error) {
    console.log(error);
    throw new Error("Notes generation failed 🩻");
  }
}

/**
 * Saves the given notes for a specific paper URL locally.
 *
 * @param {string} paperUrl - The URL of the paper.
 * @param {Array<ArxivPaperNote>} notes - The array of notes to be saved.
 * @return {void} This function does not return anything.
 */
export function saveNotesLocally(paperUrl: string, notes: Array<ArxivPaperNote>): void {
  const notesPath = `generated_notes/notes.json`;
  let notesObj: { [key: string]: Array<ArxivPaperNote> } = {};

  if (fs.existsSync(notesPath)) {
    const readNotes = fs.readFileSync(notesPath, "utf8");
    switch (true) {
      case readNotes === ``:
        notesObj[paperUrl] = [...notes];
        fs.writeFileSync(notesPath, JSON.stringify(notesObj), "utf8");
        console.log("First time saving notes locally successfully 📝📝📝 ");
        return;

      default:
        const copyNotesObj = JSON.parse(readNotes);
        if (Object.keys(copyNotesObj).includes(paperUrl)) {
          console.log("Already saved notes locally 📝📝📝 ");
        } else {
          notesObj[paperUrl] = [...notes];
          fs.writeFileSync(notesPath, JSON.stringify(notesObj), "utf8");
          console.log("Saved notes locally successfully 📝📝📝 ");
        }
        return;
    }
  }
  return;
}

/**
 * Function to process a paper by validating the URL, loading the paper, deleting pages, 
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
    // Create Supabase database
    const database = await SupabaseDatabase.fromExistingIndex();

    // Validate paper URL
    if (!paperUrl.endsWith(".pdf"))
      throw new Error("Invalid paper URL");

    // check if paper already exists in database
    const existingPaper = await database.getPaper(paperUrl);

    switch (true) {
      case !!existingPaper:
        console.log(`📃 retrieved from database: ${existingPaper.name}`);
        return existingPaper ? existingPaper.notes as Array<ArxivPaperNote> : [];

      default:
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

        console.log(`Successfully saved paper & notes to database 📝`);

        return notes;
    }
  } catch (error) {
    console.log(error);
    throw new Error(`AI minus the braids 🩻`,);
  }
};

/**
 * Asynchronously processes the main function and returns ArxivPaperNote array or null.
 *
 * @param {MainProps} paperUrl - The URL of the paper
 * @param {MainProps} paperName - The name of the paper
 * @param {MainProps} pagesToDelete - The pages to delete
 * @return {Promise<ArxivPaperNote[] | null>} Promise of ArxivPaperNote array or null
 */
export async function mainV2({ paperUrl, paperName, pagesToDelete }: MainProps): Promise<ArxivPaperNote[] | null> {
  const urlRegEx = new RegExp(`^(http|https)://(?!localhost|127\.0\.0\.1)(.*?\.pdf)$`);
  const isPdfUrl = urlRegEx.test(paperUrl);

  const isLocalPdf = fs.existsSync(paperUrl);

  if ((!isPdfUrl && !isLocalPdf) || !paperUrl.endsWith(".pdf")) throw new Error("Invalid PDF or file path.")

  console.log({ isPdfUrl, isLocalPdf })

  // check if notes have been generated for the current paper
  const notesPath = `generated_notes/${path.basename(paperUrl)}/data.json`;
  if (
    fs.existsSync(notesPath) &&
    Array.isArray(JSON.parse(fs.readFileSync(notesPath, "utf8"))) &&
    JSON
      .parse(fs.readFileSync(notesPath, "utf8"))
      .some((el: { hasOwnProperty: (arg0: string) => any; }) => el.hasOwnProperty(paperUrl))
  ) {
    console.log(`📃 retrieved from local storage: ${paperUrl}`);
    return JSON
      .parse(fs.readFileSync(notesPath, "utf8"))
      .find((el: { hasOwnProperty: (arg0: string) => any; }) => el.hasOwnProperty(paperUrl))
    [paperUrl].notes as Array<ArxivPaperNote>;
  }

  let pdfAsBuffer: Buffer;

  try {
    // Load paper from URL as buffer
    if (isPdfUrl) pdfAsBuffer = await loadPdfFromUrl({ url: paperUrl });

    // Load paper from local folder
    if (isLocalPdf) pdfAsBuffer = fs.readFileSync(paperUrl);

    // Delete pages if any
    if (pagesToDelete && pagesToDelete.length > 0)
      pdfAsBuffer = await deletePages(pdfAsBuffer!, pagesToDelete);

    // Convert PDF to documents
    const documents = await convertPdfToDocuments(pdfAsBuffer!);
    console.log(`Converted ${paperUrl} to ${documents.length} documents`);

    // Add metadata to each document
    const formattedDocs: Array<Document> = documents.map(doc => ({
      ...doc,
      metadata: {
        ...doc.metadata,
        url: paperUrl,
      },
    }));

    // Create a vector store from the documents.
    const database = await HNSWDatabase.fromDocuments(formattedDocs) as HNSWDatabase;
    console.log(`Created HNSW Database 🪪`);

    const vectorStoreDir = `vector_store/${path.basename(paperUrl)}`
    if (!fs.existsSync(vectorStoreDir)) {
      fs.mkdirSync(vectorStoreDir);
      await database.vectorStore.save(vectorStoreDir);
      console.log(`Saved HNSW Database 🪪`);
    }

    // Generate notes from the documents & save them locally
    const notes = await generateNotes(paperUrl, documents);

    database.addPaper({
      storagePath: `generated_notes/${path.basename(paperUrl)}/data.json`,
      docs: formattedDocs,
      url: paperUrl,
      name: paperName,
      notes,
    });

    return notes;
  } catch (error) {
    console.log(error);
    return null;
  }
}

