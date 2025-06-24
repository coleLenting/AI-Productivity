// server.js - Vercel-Compatible Backend with Google Gemini API
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// SECURE: API key - Use environment variable in production
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// Rate limiting middleware
const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 15, // 15 requests per minute
    message: {
        error: 'Too many requests. Please wait a minute and try again.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Apply rate limiting only to API routes
app.use('/api/', apiLimiter);

// Retry logic for Gemini API
async function makeGeminiRequestWithRetry(prompt, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            console.log(`Gemini API attempt ${attempt + 1} of ${maxRetries}`);
            
            // Use global fetch if available (Node 18+), otherwise require node-fetch
            const fetch = globalThis.fetch || require('node-fetch');
            
            const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: prompt
                        }]
                    }],
                    generationConfig: {
                        temperature: 0.7,
                        topK: 40,
                        topP: 0.95,
                        maxOutputTokens: 1024,
                    }
                })
            });

            // Handle rate limiting
            if (response.status === 429) {
                const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff
                console.log(`Rate limited. Waiting ${waitTime}ms before retry...`);
                
                if (attempt < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }
            }

            return response;

        } catch (error) {
            console.error(`Attempt ${attempt + 1} failed:`, error.message);
            
            if (attempt < maxRetries - 1) {
                const waitTime = Math.pow(2, attempt) * 1000;
                console.log(`Waiting ${waitTime}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            } else {
                throw error;
            }
        }
    }
}

// Content generation endpoint
app.post('/api/generate', async (req, res) => {
    try {
        const { prompt } = req.body;

        if (!prompt) {
            return res.status(400).json({ 
                error: 'Prompt is required' 
            });
        }

        console.log('Processing request for prompt length:', prompt.length);

        // Add professional context to the prompt
        const enhancedPrompt = `You are a professional content generator assistant. Create clear, concise, and professional content based on user requirements. 

User Request: ${prompt}

Please provide a well-structured, professional response.`;

        const response = await makeGeminiRequestWithRetry(enhancedPrompt);

        if (!response.ok) {
            const errorData = await response.text();
            let parsedError;
            
            try {
                parsedError = JSON.parse(errorData);
            } catch (e) {
                parsedError = { error: { message: errorData } };
            }
            
            if (response.status === 400) {
                return res.status(400).json({ 
                    error: 'Invalid request format' 
                });
            } else if (response.status === 429) {
                return res.status(429).json({ 
                    error: 'Rate limit exceeded. Please wait a moment and try again.',
                    retryAfter: 60
                });
            } else if (response.status === 403) {
                return res.status(403).json({ 
                    error: 'API access denied. Please contact support.' 
                });
            }
            
            return res.status(response.status).json({ 
                error: parsedError.error?.message || `Gemini API error (${response.status})` 
            });
        }

        const data = await response.json();
        
        if (data.candidates && data.candidates[0] && data.candidates[0].content) {
            const content = data.candidates[0].content.parts[0].text;
            
            res.json({ 
                content: content,
                model: 'gemini-pro',
                timestamp: new Date().toISOString()
            });
        } else {
            console.error('Unexpected Gemini response:', data);
            res.status(500).json({ 
                error: 'Unexpected response format from Gemini API' 
            });
        }

    } catch (error) {
        console.error('Server Error:', error);
        
        if (error.message && error.message.includes('fetch')) {
            res.status(503).json({ 
                error: 'Unable to connect to Gemini API. Please try again later.' 
            });
        } else {
            res.status(500).json({ 
                error: 'Internal server error. Please try again.' 
            });
        }
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        version: '2.0.0',
        model: 'gemini-pro',
        features: ['secure-api-key', 'rate-limiting', 'retry-logic'],
        environment: process.env.VERCEL ? 'vercel' : 'local'
    });
});

// Test endpoint
app.get('/api/test', (req, res) => {
    res.json({ 
        message: 'Gemini API server is running!',
        timestamp: new Date().toISOString(),
        secure: true,
        environment: process.env.VERCEL ? 'vercel' : 'local'
    });
});

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Catch-all route for SPA
app.get('*', (req, res) => {
    // If it's an API route that doesn't exist, return 404 JSON
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
    }
    
    // Otherwise serve the main HTML file
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ 
        error: 'Something went wrong!' 
    });
});

// For Vercel
if (process.env.VERCEL) {
    module.exports = app;
} else {
    // For local development
    app.listen(PORT, () => {
        console.log(`🚀 Content Generator Server running on http://localhost:${PORT}`);
        console.log(`🤖 Using Google Gemini Pro API`);
        console.log(`🔒 API key secured in backend`);
        console.log(`📝 API endpoint: http://localhost:${PORT}/api/generate`);
        console.log(`💖 Health check: http://localhost:${PORT}/api/health`);
        console.log(`🔒 Rate limiting: 15 requests per minute per IP`);
    });
}