import { SupabaseDatabase } from "database.js";
import { Document } from "langchain/document";
import { ArxivPaperNote } from "notes/prompt.js";
import {
  ANSWER_QUESTION_TOOL_SCHEMA,
  QA_OVER_PAPER_PROMPT,
  answerOutputParser,
} from "./prompt.js";
import { formatDocumentsAsString } from "langchain/util/document";
import { model } from "notes/index.js";
import { HNSWDatabase } from "hnsw-store.js";
import path from "path";
import { existsSync, readFileSync } from "fs";
import { RunnableSequence } from "langchain/runnables";


type QAResponse = Array<{
  answer: string;
  followupQuestions: string[];
}>;

/**
 * Asynchronous function for querying a model with a question, array of documents, and array of notes.
 *
 * @param {string} question - the question to be asked
 * @param {Array<Document>} documents - array of documents to be queried
 * @param {Array<ArxivPaperNote>} notes - array of notes related to the documents
 * @return {Promise<Array<{ answer: string; followupQuestions: string[] }>>} - an array of objects containing the answer and follow-up questions
 */
async function qaModel(
  question: string,
  documents: Document[],
  notes: ArxivPaperNote[],
): Promise<QAResponse> {
  try {
    if (!documents) throw new Error("No documents found");

    // Adding tools to the model to be used
    const modelWithTools = model.bind({
      tools: [ANSWER_QUESTION_TOOL_SCHEMA],
      tool_choice: "auto",
    });

    // Create a chain
    const chain = QA_OVER_PAPER_PROMPT.pipe(modelWithTools).pipe(answerOutputParser);

    // Format documents 
    const documentsAsString = formatDocumentsAsString(documents);

    // Format notes
    const notesAsString = notes.map((note) => note.note).join("\n");

    // Query model
    return await chain.invoke({
      question,
      notes: notesAsString,
      documents: documentsAsString,
    });
  } catch (error) {
    console.log(error);
    throw new Error("QA failed 🩻");
  }
}

/**
 * Generates a Q&A response using a model with HNSW.
 *
 * @param {string} question - The question for which the answer is being generated.
 * @param {Document[]} documents - The list of documents to consider for answering the question.
 * @param {ArxivPaperNote[]} notes - The notes associated with the documents.
 * @param {any} vectorStoreRetriever - The retriever for vector store.
 * @return {Promise<QAResponse>} The promise that resolves to a Q&A response.
 */
async function qaModelWithHNSW({ question, documents, notes, vectorStoreRetriever, }: {
  question: string;
  documents: Document[];
  notes: ArxivPaperNote[];
  vectorStoreRetriever: any;
}): Promise<QAResponse> {
  try {
    if (!documents || !notes || !vectorStoreRetriever) throw new Error("No documents found");

    // Format documents 
    const documentsAsString = formatDocumentsAsString(documents);

    // Format notes
    const notesAsString = notes.map((note) => note.note).join("\n");

    // Adding tools to the model to be used
    const modelWithTools = model.bind({
      tools: [ANSWER_QUESTION_TOOL_SCHEMA],
      tool_choice: "auto",
    });

    // This is a runnable sequence of tools. The first object is used to map the input
    // to the first tool in the sequence. The second item is the first tool to be applied
    // to the input, and so on.
    //
    // In this case, we are taking the input and passing it to the QA_OVER_PAPER_PROMPT
    // tool, which will generate a prompt based on the input, which is then passed to
    // the modelWithTools tool, which will generate an answer based on the prompt. Finally,
    // the answerOutputParser is run on the output of the modelWithTools to generate the
    // final output of the sequence, which is an array of objects containing the answer
    // and follow-up questions.
    const chain = RunnableSequence.from([
      {
        question: (input) => input.question,
        notes: (input) => input.notes,
        relevantDocuments: (input) => input.relevantDocuments,
      },
      QA_OVER_PAPER_PROMPT,
      modelWithTools,
      answerOutputParser,
    ]);

    // Query Model
    return await chain.invoke({
      question,
      notes: notesAsString,
      relevantDocuments: documentsAsString,
    });
  } catch (error) {
    console.log(error);
    return [{ answer: "Error", followupQuestions: ["Error"] }] as QAResponse;
  }
}

/**
 * Performs question answering on a paper based on a given question and paper URL.
 *
 * @param {string} question - The question to be answered.
 * @param {string} paperUrl - The URL of the paper to be used for question answering.
 * @return {Promise<Array<{answer: string, followupQuestions: Array<string>}>>} - A promise that resolves to an array of objects containing the answer and follow-up questions.
 * @throws {Error} - If no notes are found for the paper.
 */
export async function qaOnPaper(
  question: string, paperUrl: string
): Promise<Array<{ answer: string; followupQuestions: Array<string>; }> | Error | any> {
  try {
    // Supabase instance
    const DATABASE = await SupabaseDatabase.fromExistingIndex();
    console.log(`Loaded database instance from existing index 🫙`);

    // Return answer and follow up questions from the database if the same question exists
    const existingQa = await DATABASE.rtrnExistingQa(question);
    if (existingQa) return {
      answer: existingQa.answer,
      followupQuestions: existingQa.followup_questions,
    };

    // Get paper from database
    const paper = await DATABASE.getPaper(paperUrl);

    if (!paper?.notes) throw new Error("No notes found");

    const notes = paper.notes as ArxivPaperNote[];

    const documents = await DATABASE.vectorStore.similaritySearch(question, 10, { url: paperUrl, });
    console.log(`🤖 Fetched relevant documents: ${documents.length} documents`)

    // Query model
    const answerAndQuestions = await qaModel(
      question,
      documents,
      notes,
    );

    // Save answer and questions
    await Promise.all(answerAndQuestions.map(async (res) =>
      DATABASE.saveQa(question, res.answer, formatDocumentsAsString(documents), res.followupQuestions)
    ));

    // Return answer and questions
    return answerAndQuestions;
  } catch (error) {
    console.log(error);
    throw new Error(`AI minus the braids 🩻`,);
  }

}


/**
 * Generate QA answers based on a given question and paper URL.
 *
 * @param {string} question - The question to generate answers for.
 * @param {string} paperUrl - The URL of the paper.
 * @return {Promise<QAResponse | null>} The generated QA answers.
 */
export async function qaOnPaperV2(
  question: string, paperUrl: string,
): Promise<QAResponse | null> {
  // Check if vector store directory exists
  const vectorStoreDir = `vector_store/${path.basename(paperUrl)}`;
  if (!existsSync(vectorStoreDir)) throw new Error("No vector store directory found");

  // Retrieve notes from local storage
  const storedPaper = `local_storage/${path.basename(paperUrl)}/data.json`;
  let retrievedPaper: any;
  if (
    existsSync(storedPaper) &&
    Array.isArray(JSON.parse(readFileSync(storedPaper, "utf8"))) &&
    JSON
      .parse(readFileSync(storedPaper, "utf8"))
      .some((el: { hasOwnProperty: (arg0: string) => any; }) => el.hasOwnProperty(paperUrl))
  ) {
    console.log(`📃 retrieved from local storage: ${paperUrl}`);
    retrievedPaper = JSON
      .parse(readFileSync(storedPaper, "utf8"))
      .find((el: { hasOwnProperty: (arg0: string) => any; }) => el.hasOwnProperty(paperUrl))
    [paperUrl];
  }

  if (!retrievedPaper?.notes) throw new Error("No text found");

  const { notes } = retrievedPaper as { notes: ArxivPaperNote[]; };

  try {
    // HNSW instance
    const database = await HNSWDatabase.fromExistingStore(vectorStoreDir) as HNSWDatabase;
    console.log(`Loaded HNSW instance from existing store 🫙`);

    // Initialize a retriever wrapper around the vector store
    const vectorStoreRetriever = database.vectorStore.asRetriever();
    // const documents = await database.vectorStore.similaritySearch(question, 10);
    const documents = await vectorStoreRetriever.getRelevantDocuments(question);
    console.log(`🤖 Fetched relevant documents: ${documents.length} documents`);

    const answerAndQuestions = await qaModelWithHNSW({
      question,
      documents,
      notes,
      vectorStoreRetriever,
    });

    // save questions and answers
    if (answerAndQuestions[0].answer !== "Error") {
      database.saveQA(
        `local_storage/${path.basename(paperUrl)}/qa_data.json`,
        question,
        answerAndQuestions[0].answer,
        formatDocumentsAsString(documents),
        answerAndQuestions[0].followupQuestions,
      );
      console.log(`🤖 Saved questions and answers data to local storage`);
    }
    // Return answer and questions
    return answerAndQuestions;
  } catch (error) {
    console.log(error);
    return null;
  }

}
