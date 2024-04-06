import express from "express";
import swaggerUI from "swagger-ui-express";
import swaggerJSDoc from "swagger-jsdoc";
import { main as takeNotes, mainV2 as takeNotesV2 } from "notes/index.js";
import { qaOnPaper, qaOnPaperV2 } from "qa/index.js";


const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Your API Documentation',
      version: '1.0.0',
      description: 'API Documentation generated using Swagger and JSDoc',
    },
  },
  apis: ['./src/server.ts'], // Path to the JSDoc annotated files
};

const swaggerSpec = swaggerJSDoc(options);

/**
 * Processes a string of comma-separated page numbers and returns an array of integers.
 *
 * @param {string} pagesToDelete - A string containing comma-separated page numbers.
 * @return {Array<number>} An array of integers representing the page numbers.
 */
function processPagesToDelete(pagesToDelete: string): Array<number> {
  const numArr = pagesToDelete.split(",").map((num) => parseInt(num.trim()));
  return numArr;
}

function main() {
  const app = express();
  const port = process.env.PORT || 8080;

  app.use(express.json());

  app.get("/", (_req, res) => {
    // health check
    res.status(200).send("ok");
  });

  app.use('/api-docs', swaggerUI.serve, swaggerUI.setup(swaggerSpec));
  
  /**
    * @openapi
    * /take-notes:
    *   post:
    *     summary: Take notes from a paper
    *     tags: [Notes]
    *     requestBody:
    *       required: true
    *       content:
    *         application/json:
    *           schema:
    *             type: object
    *             properties:
    *               paperUrl:
    *                 type: string
    *                 example: "http://example.com/paper.pdf"
    *               paperName:
    *                 type: string
    *                 example: "Sample Paper"
    *               pagesToDelete:
    *                 type: string
    *                 example: "1,2,3"
    *     responses:
    *       200:
    *         description: Success response with the notes on the PDF
    */
  app.post("/take-notes", async (req, res) => {
    try {
      // Extract the paperUrl, paperName & optional pagesToDelete from the request body
      const { paperUrl, paperName, pagesToDelete }: { paperUrl: string; paperName: string; pagesToDelete?: string } = req.body;
      console.log(req.body);

      // convert pagesToDelete back to array numbers
      let pagesToDeleteArray: Array<number> = [];
      if (pagesToDelete) pagesToDeleteArray = processPagesToDelete(pagesToDelete);

      // call the takeNotes function
      const notes = await takeNotesV2({ paperUrl, paperName, pagesToDelete: pagesToDeleteArray });

      return res.status(200).send(notes);
    } catch (error) {
      console.log(error);
      return res.status(500).send(error);
    }
  });

  /**
   * @openapi
   * /qa:
   *   post:
   *     summary: Run a question-answering task on a pdf
   *     tags: [QA]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               paperUrl:
   *                 type: string
   *                 example: "http://example.com/paper.pdf"
   *               question:
   *                 type: string
   *                 example: "What is the main conclusion of the paper?"
   *     responses:
   *       200:
   *         description: Success response with the QA result and follow up questions.
   */
  app.post("/qa", async (req, res) => {
    try {
      // Extract the paperUrl and question from the request body
      const { paperUrl, question } = req.body;

      // call the qaOnPaper function
      const qa = await qaOnPaperV2(question, paperUrl);

      return res.status(200).send(qa);
    } catch (error) {
      console.log(error);
      return res.status(500).send(error);
    }
  });

  app.listen(port, () => {
    console.log(`🔊 on port ${port} 🚀🚀🚀`);
  });
}

main();
