import { ChatPromptTemplate, HumanMessagePromptTemplate, SystemMessagePromptTemplate } from "langchain/prompts";
import { BaseMessageChunk } from "langchain/schema";

export const SYSTEM_MESSAGE2 = `
  Use the following pieces of context to answer the question at the end. 
  If you don't know the answer, just say that you don't know, don't try to make up an answer.
  ----------------
  CONTEXT: Notes on the text: {notes}. Relevant parts of the text relating to the question: {relevantDocuments}
  ----------------
  QUESTION: {question}
  ----------------
  Helpful Answer:
`;

export const SYSTEM_MESSAGE = `
  You are an expert of the topic the text is about. 
  You are helping a student with their research.
  The student has a question regarding the text they are reading.
  Here are their notes on the text:
  {notes}

  And here are some relevant parts of the text relating to their question:
  {relevantDocuments}

  Answer the student's question in the context of the text. You should also provide suggested follow up questions.
`;

export const QA_OVER_PAPER_PROMPT = ChatPromptTemplate.fromMessages([
  SystemMessagePromptTemplate.fromTemplate(SYSTEM_MESSAGE2),
  HumanMessagePromptTemplate.fromTemplate(`Question: {question}`),
]);

export const ANSWER_QUESTION_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "questionAnswer",
    description: "The answer to the question",
    parameters: {
      type: "object",
      properties: {
        answer: {
          type: "string",
          description: "The answer to the question",
        },
        followupQuestions: {
          type: "array",
          items: {
            type: "string",
            description: "Follow up questions the student should also ask",
          },
        },
      },
      required: ["answer", "followupQuestions"],
    },
  },
};

/**
 * Parses the output and returns an array of objects containing the answer and follow-up questions.
 *
 * @param {BaseMessageChunk} output - the output to be parsed
 * @return {Array<{ answer: string; followupQuestions: string[] }>} the parsed response array
 */
export const answerOutputParser = (output: BaseMessageChunk): Array<{ answer: string; followupQuestions: string[] }> => {
  const toolCalls = output.additional_kwargs.tool_calls;

  if (!toolCalls) throw new Error("Missing 'tool_calls' in notes output");

  return toolCalls.map(call => JSON.parse(call.function.arguments)).flat();
};


const aiMsg = [
  "ai",
  `You are an expert of the topic the text is about. 
  You are helping a student with their research.
  The student has a question regarding the text they are reading.
  Here are their notes on the text:
  {notes}

  And here are some relevant parts of the text relating to their question:
  {relevantDocuments}

  Answer the student's question in the context of the text. You should also provide suggested follow up questions.`,
]