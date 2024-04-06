# Arxiv RAG

## Introduction

Arxiv RAG is a web application and API designed for generating notes and answering questions on Arxiv papers using Large Language Models (LLMs). This project leverages the Unstructured API for parsing and chunking PDFs and Supabase for the PostgreSQL database and querying embeddings.

## Setup

### Prerequisites

- Docker
- Node.js
- Yarn package manager
- Supabase account
- Unstructured API key

### Environment Configuration

Create a `.env.development.local` file in the `./api` directory with the following content:

```shell
UNSTRUCTURED_API_KEY=<YOUR_API_KEY>
SUPABASE_PRIVATE_KEY=<YOUR_API_KEY>
SUPABASE_URL=<YOUR_URL>
OPENAI_API_KEY=<YOUR_API_KEY>
```

### Starting Unstructured with Docker

Start a local instance of Unstructured with the following Docker command:

```shell
docker run -p 8000:8000 -d --rm --name unstructured-api quay.io/unstructured-io/unstructured-api:latest --port 8000 --host 0.0.0.0
```

### Database Setup in Supabase

Execute the following SQL commands in your Supabase project to set up the required database structure. These SQL commands are creating tables to store data related to Arxiv papers, embeddings, and question answering. Additionally, a function named `match_documents` is being created for document matching using embeddings.:

```sql
-- Enable the pgvector extension
create extension vector;

-- Create tables for storing Arxiv papers, embeddings, and question answering data
CREATE TABLE arxiv_papers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  paper TEXT,
  arxiv_url TEXT,
  notes JSONB[],
  name TEXT
);

CREATE TABLE arxiv_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  content TEXT,
  embedding vector,
  metadata JSONB
);

CREATE TABLE arxiv_question_answering (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  question TEXT,
  answer TEXT,
  followup_questions TEXT[],
  context TEXT
);

-- Create a function for document matching
create function match_documents (
  query_embedding vector(1536),
  match_count int DEFAULT null,
  filter jsonb DEFAULT '{}'
) returns table (
  id UUID,
  content text,
  metadata jsonb,
  embedding vector,
  similarity float
)
language plpgsql
as $$
#variable_conflict use_column
begin
  return query
  select
    id,
    content,
    metadata,
    embedding,
    1 - (arxiv_embeddings.embedding <=> query_embedding) as similarity
  from arxiv_embeddings
  where metadata @> filter
  order by arxiv_embeddings.embedding <=> query_embedding
  limit match_count;
end;
$$;
```

The `match_documents` function takes a query embedding vector, an optional match count, and a filter as input. It returns a table with columns for id, content, metadata, embedding, and similarity. The function calculates the similarity between the query embedding and the embeddings in the arxiv_embeddings table, filters based on metadata, orders by similarity, and limits the results by match count.

### Supabase Type Generation

Install Supabase CLI globally:

```shell
npm i -g supabase
```

Login via CLI:

```shell
npx supabase login
```

Add your project ID to the Supabase generate types script in `api/package.json`:

```json
{
  "gen:supabase:types": "touch ./src/generated/db.ts && npx supabase gen types typescript --schema public > ./src/generated/db.ts --project-id <YOUR_PROJECT_ID>"
}
```

## Running the Application

### Build the API Server

```shell
yarn build
```

### Start the API Server

```shell
yarn start:api
```

### Start the Web Server

```shell
yarn start:web
```
