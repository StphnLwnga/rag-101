import { Document } from "langchain/document";
import { SupabaseClient, createClient } from "@supabase/supabase-js";
import { SupabaseVectorStore } from "langchain/vectorstores/supabase";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { Database } from "generated/db.js";
import { ArxivPaperNote } from "notes/prompt.js";


export const ARXIV_PAPERS_TABLE = "arxiv_papers";
export const ARXIV_EMBEDDINGS_TABLE = "arxiv_embeddings";
export const ARXIV_QA_TABLE = "arxiv_question_answering";

export class SupabaseDatabase {
  vectorStore: SupabaseVectorStore;

  client: SupabaseClient<Database, "public", any>;

  /**
   * Initializes a new instance of the class with the given vector store and Supabase client.
   *
   * @param {SupabaseVectorStore} vectorStore - The vector store to be used.
   * @param {SupabaseClient<Database, "public", any>} client - The Supabase client to be used.
   */
  constructor(
    vectorStore: SupabaseVectorStore,
    client: SupabaseClient<Database, "public", any>
  ) {
    this.vectorStore = vectorStore;
    this.client = client;
  }

  /**
   * Create a new SupabaseDatabase instance from an existing index.
   *
   * @return {Promise<SupabaseDatabase>} A Promise that resolves to a SupabaseDatabase instance
   */
  static async fromExistingIndex(): Promise<SupabaseDatabase> {
    try {
      const privateKey = process.env.SUPABASE_PRIVATE_KEY;
      if (!privateKey) throw new Error(`Missing SUPABASE_PRIVATE_KEY`);

      const url = process.env.SUPABASE_URL;
      if (!url) throw new Error(`Missing SUPABASE_URL`);

      const client = createClient<Database>(url, privateKey);

      const vectorStore = await SupabaseVectorStore.fromExistingIndex(
        new OpenAIEmbeddings(),
        {
          client,
          tableName: ARXIV_EMBEDDINGS_TABLE,
          queryName: "match_documents",
        }
      );

      return new this(vectorStore, client);
    } catch (error) {
      console.log(error);
      throw error;
    }
  }

  /**
   * Creates a SupabaseDatabase instance from an array of Documents.
   *
   * @param {Document[]} docs - The array of Documents to create the database from.
   * @return {Promise<SupabaseDatabase>} A Promise that resolves to a SupabaseDatabase instance.
   * @throws {Error} If the SUPABASE_PRIVATE_KEY or SUPABASE_URL environment variables are missing.
   */
  static async fromDocuments(docs: Document[]): Promise<SupabaseDatabase> {
    try {
      const privateKey = process.env.SUPABASE_PRIVATE_KEY;
      if (!privateKey) throw new Error(`Missing SUPABASE_PRIVATE_KEY`);

      const url = process.env.SUPABASE_URL;
      if (!url) throw new Error(`Missing SUPABASE_URL`);

      const client = createClient<Database>(url, privateKey);

      const vectorStore = await SupabaseVectorStore.fromDocuments(
        docs,
        new OpenAIEmbeddings(),
        {
          client,
          tableName: ARXIV_EMBEDDINGS_TABLE,
          queryName: "match_documents",
        }
      );

      return new this(vectorStore, client);
    } catch (error) {
      console.log(error);
      throw error;
    }
  }


  /**
   * Adds a paper to the database.
   *
   * @param {Object} paper - The paper object to be added.
   *   - `paper` (string): The content of the paper.
   *   - `url` (string): The URL of the paper.
   *   - `notes` (Array<ArxivPaperNote>): An array of notes related to the paper.
   *   - `name` (string): The name of the paper.
   * @return {Promise<void>} A promise that resolves when the paper is successfully added to the database.
   * @throws {Error} If there is an error adding the paper to the database.
   */
  async addPaper({ paper, url, notes, name, }: {
    paper: string;
    url: string;
    notes: Array<ArxivPaperNote>;
    name: string;
  }): Promise<void> {
    try {
      await this
        .client
        .from(ARXIV_PAPERS_TABLE)
        .insert([{ paper, arxiv_url: url, notes, name, },]);
    } catch (error) {
      console.error("Error adding paper to database", error);
      throw new Error("Error adding paper to database" + JSON.stringify(error, null, 2));
    }
  }

  /**
   * Retrieves a paper from the database based on the provided URL.
   *
   * @param {string} url - The URL of the paper.
   * @return {Promise<Database["public"]["Tables"]["arxiv_papers"]["Row"] | null>}
   * A promise that resolves to the retrieved paper or null if an error occurs.
   */
  async getPaper(
    url: string
  ): Promise<Database["public"]["Tables"]["arxiv_papers"]["Row"] | null> {
    try {
      const { data, error } = await this.client
        .from(ARXIV_PAPERS_TABLE)
        .select()
        .eq("arxiv_url", url);

      if (error || !data) {
        console.error("Error getting paper from database");
        return null;
      }

      console.log(`📃 retrieved from database: ${data[0].name}`);

      return data[0];
    } catch (error) {
      console.error("Error getting paper from database", error);
      throw error;
    }
  }

  /**
   * Check if a question already exists in the database and return it.
   */
  async rtrnExistingQa(question: string) {
    try {
      const { data } = await this.client
        .from(ARXIV_QA_TABLE)
        .select()
        .eq("question", question)
        .limit(1);

      return data?.[0];
    } catch (error) {
      console.error("Error checking if QA exists in database", error);
      throw error;
    }
  }

  /**
   * Save a question and answer pair along with context and follow-up questions to the database.
   *
   * @param {string} question - The question to be saved.
   * @param {string} answer - The answer to the question.
   * @param {string} context - The context related to the question and answer.
   * @param {string[]} followupQuestions - An array of follow-up questions related to the main question.
   * @return {Promise<void>} Promise that resolves when the question and answer pair is saved successfully.
   */
  async saveQa(
    question: string,
    answer: string,
    context: string,
    followupQuestions: string[]
  ): Promise<void> {
    try {
      await this.client.from(ARXIV_QA_TABLE).insert({
        question,
        answer,
        context,
        followup_questions: followupQuestions,
      });
    } catch (error) {
      console.error("Error saving QA to database", error);
      throw error;
    }
  }
}
