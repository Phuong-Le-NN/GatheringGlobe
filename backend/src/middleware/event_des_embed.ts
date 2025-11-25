import { pipeline } from '@huggingface/transformers';

// The model to use. Xenova is a community prefix for models optimized for Transformers.js.
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';

/**
 * Converts text inputs into 384-dimensional embedding vectors.
 * @param {string[]} texts - An array of sentences or descriptions to embed.
 * @returns {Promise<Float32Array[]>} A promise that resolves to an array of embedding arrays.
 */
// async function generateEmbeddings(texts: string[]) {
//     // 1. Create a feature-extraction pipeline, which loads the model.
//     // The model files are downloaded and cached automatically the first time.
//     const extractor = await pipeline('feature-extraction', MODEL_NAME);

//     // 2. Compute the sentence embeddings for all texts in a batch.
//     const output = await extractor(texts, {
//         pooling: 'mean',    // Use the mean pooling strategy (standard for sentence embeddings)
//         normalize: true,    // Normalize the vectors to length 1 (recommended for Pinecone)
//         // You can set 'quantized: true' for even faster, smaller inference (optional)
//     });

//     // 3. The output is a Tensor object. We convert it to a standard array format.
//     // .tolist() converts the Tensor to a nested JavaScript Array (array of arrays).
//     // The shape will be [Number_of_Sentences, 384]
//     return output.tolist();
// }

export async function generateOneSingleEmbeddings(text: string) {
    const extractor = await pipeline('feature-extraction', MODEL_NAME, { dtype: 'fp16' });
    const query_embedding = await extractor(text, { /* ... options */ });
    return query_embedding;
}


const descriptions = [
    "A sleek, durable laptop designed for students with long battery life.",
    "Ergonomic mechanical keyboard with silent tactile switches and customizable RGB.",
    "Affordable computer for college."
];

// (async () => {
//     console.log("Generating embeddings for descriptions...");

//     try {
//         const embeddings = await generateEmbeddings(descriptions);

//         console.log(`Successfully generated ${embeddings.length} embeddings.`);
//         console.log(`First embedding dimension: ${embeddings[0].length}`);

//         // This is the vector you will send to Pinecone
//         console.log("Example Embedding (first 5 values):", embeddings[0].slice(0, 5));

//     } catch (error) {
//         console.error("An error occurred during embedding generation:", error);
//     }
// })();


// (async () => {
//     console.log("Generating embeddings for descriptions...");

//     try {
//         const embedding = await generateOneSingleEmbeddings(descriptions[0]);
//         console.log(`Successfully generated embedding.`);
//         // This is the vector you will send to Pinecone
//         console.log("Example Embedding (first 5 values):", embedding.slice(0, 5));

//     } catch (error) {
//         console.error("An error occurred during embedding generation:", error);
//     }
// })();