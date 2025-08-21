import OpenAI from 'openai';
import { getOpenAIApiKey } from './config.js';

export type BinStatus = 'street' | 'driveway' | 'unknown';

export async function classifyBins(imageBase64: string): Promise<{ status: BinStatus; reasoning: string }> {
  const apiKey = getOpenAIApiKey();
  if (!apiKey) {
    throw new Error('Missing OpenAI API key. Provide via config or env OPENAI_API_KEY');
  }

  const openai = new OpenAI({ apiKey });

  const imageUrl = `data:image/jpeg;base64,${imageBase64}`;

  const prompt = [
    'You are analyzing a Ring doorbell snapshot to determine garbage bin location.',
    'Classify into one of:',
    ' - street: bins appear at the curb/street for pickup',
    ' - driveway: bins appear near house/driveway (not yet at curb)',
    ' - unknown: cannot confidently determine or bins not visible',
    'Return a concise JSON object: {"status":"street|driveway|unknown","reasoning":"short"}',
  ].join('\n');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
    temperature: 0,
    response_format: { type: 'json_object' },
  });

  const text = response.choices[0]?.message?.content || '{"status":"unknown","reasoning":"no response"}';

  try {
    const parsed = JSON.parse(text) as { status: BinStatus; reasoning: string };
    if (parsed.status !== 'street' && parsed.status !== 'driveway' && parsed.status !== 'unknown') {
      return { status: 'unknown', reasoning: 'invalid classification' };
    }
    return parsed;
  } catch {
    return { status: 'unknown', reasoning: 'invalid JSON from model' };
  }
}

export async function analyzeImage(imageBase64: string, question: string): Promise<string> {
  const apiKey = getOpenAIApiKey();
  if (!apiKey) {
    throw new Error('Missing OpenAI API key. Provide via config or env OPENAI_API_KEY');
  }

  const openai = new OpenAI({ apiKey });
  const imageUrl = `data:image/jpeg;base64,${imageBase64}`;

  const systemPrompt = [
    'You are an expert home security analyst with advanced image recognition capabilities.',
    'You are analyzing Ring doorbell camera images to provide detailed, accurate assessments.',
    'Use your thinking process to carefully examine the image before providing your answer.',
    'Consider multiple aspects: objects, people, vehicles, activities, security concerns, and environmental factors.',
    'Provide comprehensive, detailed answers that would be valuable for home monitoring and security.',
    'If something is unclear or not visible, explicitly state this rather than making assumptions.',
    'Focus on practical details that help with home security and monitoring decisions.',
  ].join('\n');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: question },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
    temperature: 0.1,
    max_tokens: 1000,
    tools: [
      {
        type: 'function',
        function: {
          name: 'thinking_process',
          description: 'Use this to think through the image analysis step by step',
          parameters: {
            type: 'object',
            properties: {
              observations: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of key observations from the image'
              },
              analysis: {
                type: 'string',
                description: 'Detailed analysis of what is observed'
              },
              confidence: {
                type: 'string',
                enum: ['high', 'medium', 'low'],
                description: 'Confidence level in the analysis'
              }
            },
            required: ['observations', 'analysis', 'confidence']
          }
        }
      }
    ],
    tool_choice: { type: 'function', function: { name: 'thinking_process' } }
  });

  const message = response.choices[0]?.message;
  if (message?.tool_calls?.[0]) {
    // Parse the thinking process
    const toolCall = message.tool_calls[0];
    const thinkingData = JSON.parse(toolCall.function.arguments);
    
    // Now get the final answer
    const finalResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: question },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
        {
          role: 'assistant',
          content: `I've analyzed the image and found:\n\n**Observations:**\n${thinkingData.observations.map((obs: string) => `• ${obs}`).join('\n')}\n\n**Analysis:** ${thinkingData.analysis}\n\n**Confidence:** ${thinkingData.confidence}\n\nNow, let me provide a comprehensive answer to your question.`
        }
      ],
      temperature: 0.1,
      max_tokens: 800,
    });

    return finalResponse.choices[0]?.message?.content || 'Sorry, I could not analyze the image at this time.';
  }

  return message?.content || 'Sorry, I could not analyze the image at this time.';
}

export async function analyzeImageWithThinking(imageBase64: string, question: string): Promise<{
  answer: string;
  thinking: {
    observations: string[];
    analysis: string;
    confidence: string;
  };
}> {
  const apiKey = getOpenAIApiKey();
  if (!apiKey) {
    throw new Error('Missing OpenAI API key. Provide via config or env OPENAI_API_KEY');
  }

  const openai = new OpenAI({ apiKey });
  const imageUrl = `data:image/jpeg;base64,${imageBase64}`;

  const systemPrompt = [
    'You are an expert home security analyst with advanced image recognition capabilities.',
    'You are analyzing Ring doorbell camera images to provide detailed, accurate assessments.',
    'Use your thinking process to carefully examine the image before providing your answer.',
    'Consider multiple aspects: objects, people, vehicles, activities, security concerns, and environmental factors.',
    'Provide comprehensive, detailed answers that would be valuable for home monitoring and security.',
    'If something is unclear or not visible, explicitly state this rather than making assumptions.',
    'Focus on practical details that help with home security and monitoring decisions.',
  ].join('\n');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: question },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
    temperature: 0.1,
    max_tokens: 1000,
    tools: [
      {
        type: 'function',
        function: {
          name: 'thinking_process',
          description: 'Use this to think through the image analysis step by step',
          parameters: {
            type: 'object',
            properties: {
              observations: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of key observations from the image'
              },
              analysis: {
                type: 'string',
                description: 'Detailed analysis of what is observed'
              },
              confidence: {
                type: 'string',
                enum: ['high', 'medium', 'low'],
                description: 'Confidence level in the analysis'
              }
            },
            required: ['observations', 'analysis', 'confidence']
          }
        }
      }
    ],
    tool_choice: { type: 'function', function: { name: 'thinking_process' } }
  });

  const message = response.choices[0]?.message;
  if (message?.tool_calls?.[0]) {
    // Parse the thinking process
    const toolCall = message.tool_calls[0];
    const thinkingData = JSON.parse(toolCall.function.arguments);
    
    // Now get the final answer
    const finalResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: question },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
        {
          role: 'assistant',
          content: `I've analyzed the image and found:\n\n**Observations:**\n${thinkingData.observations.map((obs: string) => `• ${obs}`).join('\n')}\n\n**Analysis:** ${thinkingData.analysis}\n\n**Confidence:** ${thinkingData.confidence}\n\nNow, let me provide a comprehensive answer to your question.`
        }
      ],
      temperature: 0.1,
      max_tokens: 800,
    });

    return {
      answer: finalResponse.choices[0]?.message?.content || 'Sorry, I could not analyze the image at this time.',
      thinking: thinkingData
    };
  }

  return {
    answer: message?.content || 'Sorry, I could not analyze the image at this time.',
    thinking: {
      observations: [],
      analysis: 'No thinking process available',
      confidence: 'unknown'
    }
  };
}


