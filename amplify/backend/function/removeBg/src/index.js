const fs = require('fs');
const path = require('path');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Requested-With',
  'Access-Control-Allow-Methods': 'OPTIONS,POST'
};

async function runBackrem(inputPath, outputPath) {
  const backrem = require('backrem');

  const candidates = [
    backrem,
    backrem && backrem.removeBackground,
    backrem && backrem.remove,
    backrem && backrem.default,
    backrem && backrem.default && backrem.default.removeBackground,
    backrem && backrem.default && backrem.default.remove
  ].filter((candidate) => typeof candidate === 'function');

  if (candidates.length === 0) {
    throw new Error('backrem library does not expose a callable background removal function.');
  }

  const remover = candidates[0];
  const result = remover(inputPath, outputPath);

  if (result && typeof result.then === 'function') {
    await result;
    return;
  }

  if (result instanceof Promise) {
    await result;
  }
}

async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: '',
      isBase64Encoded: false
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Method Not Allowed' }),
      isBase64Encoded: false
    };
  }

  let inputTempFile;
  let outputTempFile;

  try {
    const bodyContent = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf-8')
      : event.body || '';

    let parsed;
    try {
      parsed = typeof bodyContent === 'string' && bodyContent.trim() ? JSON.parse(bodyContent) : {};
    } catch (parseError) {
      throw new Error('Invalid JSON payload.');
    }

    const imageData = parsed.image || parsed.data;

    if (!imageData || typeof imageData !== 'string') {
      throw new Error('Missing image data in request body.');
    }

    const base64String = imageData.includes(',') ? imageData.split(',').pop() : imageData;

    const imageBuffer = Buffer.from(base64String, 'base64');

    if (!imageBuffer.length) {
      throw new Error('Invalid image data provided.');
    }

    const timestamp = Date.now();
    inputTempFile = path.join('/tmp', `input-${timestamp}.png`);
    outputTempFile = path.join('/tmp', `output-${timestamp}.png`);

    await fs.promises.writeFile(inputTempFile, imageBuffer);

    await runBackrem(inputTempFile, outputTempFile);

    const outputBuffer = await fs.promises.readFile(outputTempFile);

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'image/png'
      },
      body: outputBuffer.toString('base64'),
      isBase64Encoded: true
    };
  } catch (error) {
    console.error('Background removal failed:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ message: error.message || 'Background removal failed.' }),
      isBase64Encoded: false
    };
  } finally {
    const cleanup = [];
    if (inputTempFile) {
      cleanup.push(fs.promises.unlink(inputTempFile).catch(() => {}));
    }
    if (outputTempFile) {
      cleanup.push(fs.promises.unlink(outputTempFile).catch(() => {}));
    }
    if (cleanup.length) {
      await Promise.allSettled(cleanup);
    }
  }
}

exports.handler = handler;
