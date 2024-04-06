import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { Document } from "@langchain/core/documents";
import { OpenAIEmbeddings, ChatOpenAI } from "@langchain/openai";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { formatDocumentsAsString } from "langchain/util/document";
import { ArxivPaperNote } from "notes/prompt.js";
import path from "path";
import * as fs from 'fs';


export class HNSWDatabase {
  vectorStore: HNSWLib;

  constructor(vectorStore: HNSWLib) {
    this.vectorStore = vectorStore;
  }

  static async fromDocuments(docs: Document[]) {
    try {
      const vectorStore = await HNSWLib.fromDocuments(docs, new OpenAIEmbeddings());

      return new this(vectorStore);
    } catch (error) {
      console.log(error);
      return null;
    }
  }

  static async fromExistingStore(dir: string) {
    try {
      const vectorStore = await HNSWLib.load(dir, new OpenAIEmbeddings());

      return new this(vectorStore);
    } catch (error) {
      console.log(error);
      return null;
    }
  }

  addPaper({ storagePath, docs, url, name, notes }: {
    storagePath: string;
    url: string;
    name: string;
    docs: Document[];
    notes: ArxivPaperNote[];
  }) {
    if (!existsSync(`local_storage/${path.basename(url)}`))
      fs.mkdirSync(`local_storage/${path.basename(url)}`);

    return saveToLocalStorage(storagePath, docs, url, name, notes);
  }

  getPaper({ url }: { url: string }) {
    return getPaperFromLocalStorage(url);
  }

  saveQA(
    storagePath: string,
    question: string,
    answer: string,
    context: string,
    followupQuestions: string[],
  ) {
    return saveQAToLocalStorage({ storagePath, question, answer, context, followupQuestions });
  }
}

/**
 * Saves documents to local storage if path does not exist, updates otherwise.
 * @param {string} storagePath - The path to the local storage file
 * @param {Document[]} docs - The array of documents to save
 * @param {string} url - The URL of the document
 * @param {string} name - The name of the document
 * @param {ArxivPaperNote[]} notes - The array of notes related to the document
 * @return {void}
 */
export const saveToLocalStorage = (
  storagePath: string,
  docs: Document[],
  url: string,
  name: string,
  notes: Array<ArxivPaperNote>
): void => {
  if (!existsSync(storagePath)) {
    const paperObj = {
      [url]: {
        paper: formatDocumentsAsString(docs),
        name,
        url,
        notes,
        dateCreated: new Date().toISOString(),
      }
    }
    writeFileSync(storagePath, JSON.stringify([paperObj]), "utf-8");
    console.log(`Successfully created local storage 🫙`);
    return;
  } else {
    const storageObj = readFileSync(storagePath, "utf-8");

    if (storageObj !== ``) {
      const copyPaperObj: {
        [x: string]: {
          paper: string;
          name: string;
          url: string;
          notes: ArxivPaperNote[];
          dateCreated?: string;
        };
      }[] = [...JSON.parse(storageObj)];

      const copyHasUrl = copyPaperObj.some(
        (el: { hasOwnProperty: (arg0: string) => any; }) => el.hasOwnProperty(url)
      );

      if (!copyHasUrl) {
        const obj: {
          [x: string]: {
            paper: string;
            name: string;
            url: string;
            notes: ArxivPaperNote[];
            dateCreated?: string;
          };
        } = {}
        obj[url] = {
          paper: formatDocumentsAsString(docs),
          name,
          url,
          notes,
          dateCreated: new Date().toISOString(),
        };

        writeFileSync(storagePath, JSON.stringify([...copyPaperObj, obj]), "utf-8");
        console.log(`Successfully updated local storage 🫙`);
        return;
      }
      console.log(`Paper already saved in local storage 🫙`);
      return;
    }
  }
}

/**
 * Saves a new question and answer to local storage or updates an existing storage with a new entry.
 *
 * @param {string} storagePath - The path to the local storage file.
 * @param {string} question - The question to be saved.
 * @param {string} answer - The answer to the question.
 * @param {string} context - The context or category of the question.
 * @param {Array<string>} followupQuestions - An array of follow-up questions related to the main question.
 */
export const saveQAToLocalStorage = ({
  storagePath, question, answer, context, followupQuestions,
}: {
  storagePath: string;
  question: string;
  answer: string;
  context: string;
  followupQuestions: Array<string>;
}) => {
  if (!existsSync(storagePath)) {
    writeFileSync(
      storagePath,
      JSON.stringify(
        [{ question, answer, context, followupQuestions, dateCreated: new Date().toISOString() }],
      ),
      "utf-8",
    );
    console.log(`Successfully created QA local storage 🫙`);
    return;
  }
  const storageObj = readFileSync(storagePath, "utf-8");

  writeFileSync(
    storagePath,
    JSON.stringify([
      ...JSON.parse(storageObj),
      { question, answer, context, followupQuestions, dateCreated: new Date().toISOString() },
    ]),
    "utf-8",
  );
  console.log(`Successfully updated QA local storage 🫙`);
  return;
}


/**
 * Retrieves the paper data from local storage based on the provided URL.
 *
 * @param {string} url - The URL of the paper to retrieve.
 * @return {any} The paper data if found in local storage, otherwise null.
 */
export const getPaperFromLocalStorage = (url: string): any => {
  const storagePath = `local_storage/${path.basename(url)}/data.json`;

  if (
    existsSync(storagePath) &&
    Array.isArray(JSON.parse(readFileSync(storagePath, "utf8"))) &&
    JSON
      .parse(readFileSync(storagePath, "utf8"))
      .some((el: { hasOwnProperty: (arg0: string) => any; }) => el.hasOwnProperty(url))
  ) {
    console.log(`📃 retrieved from local storage: ${url}`);
    return JSON
      .parse(readFileSync(storagePath, "utf8"))
      .find((el: { hasOwnProperty: (arg0: string) => any; }) => el.hasOwnProperty(url))
    [url];
  }

  return null;
}

