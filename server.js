// server.js - Vercel-Compatible Backend with Google Gemini API and Template Support
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// SECURE: API key - Use environment variable in production
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// Template definitions for different content types
const CONTENT_TEMPLATES = {
    linkedin: {
        name: 'LinkedIn Post',
        description: 'Professional social media content with engagement focus',
        promptModifier: `Create a LinkedIn post with the following structure:
        - Start with an attention-grabbing hook or question
        - Use 2-3 short paragraphs with line breaks for readability
        - Include relevant insights or personal experience
        - End with a clear call-to-action or question to encourage engagement
        - Add 3-5 relevant hashtags at the end
        - Use **bold** for emphasis on key points
        - Keep it professional but conversational
        - Optimal length: 150-300 words`,
        formatting: 'markdown'
    },
    email: {
        name: 'Professional Email',
        description: 'Structured business email with proper formatting',
        promptModifier: `Create a professional email with this structure:
        - **Subject:** Clear and specific subject line
        - **Greeting:** Appropriate salutation
        - **Opening:** Brief context or purpose
        - **Body:** Main content in 2-3 paragraphs with clear structure
        - **Action Items:** Use bullet points (-) if applicable
        - **Closing:** Professional sign-off
        - Use **bold** for important points
        - Keep paragraphs concise and scannable
        - Maintain professional but friendly tone`,
        formatting: 'markdown'
    },
    report: {
        name: 'Business Report',
        description: 'Structured report with sections and data presentation',
        promptModifier: `Create a structured business report with:
        - # Main Title
        - ## Executive Summary (brief overview)
        - ## Key Findings (use bullet points with -)
        - ## Detailed Analysis (2-3 subsections with ###)
        - ## Recommendations (numbered list or bullet points)
        - ## Conclusion
        - Use **bold** for metrics, dates, and important data
        - Use > blockquotes for key insights or quotes
        - Include clear section headers with proper markdown hierarchy
        - Present data in an organized, scannable format`,
        formatting: 'markdown'
    },
    blog: {
        name: 'Blog Post',
        description: 'Engaging blog content with SEO-friendly structure',
        promptModifier: `Create a blog post with this structure:
        - # Compelling Title (H1)
        - Brief engaging introduction paragraph
        - ## Main sections with descriptive subheadings (H2)
        - ### Subsections as needed (H3)
        - Use bullet points (-) for lists and tips
        - Include **bold** for key terms and important points
        - Use *italics* for emphasis and quotes
        - Add > blockquotes for important insights or statistics
        - End with a strong conclusion and call-to-action
        - Write in an engaging, conversational tone
        - Aim for 500-800 words with good readability`,
        formatting: 'markdown'
    },
    default: {
        name: 'General Content',
        description: 'Well-formatted general purpose content',
        promptModifier: `Create well-structured content with:
        - Clear hierarchy using # ## ### for headings as appropriate
        - Use **bold** for important points and key terms
        - Use *italics* for emphasis
        - Organize information with bullet points (-) when listing items
        - Use > blockquotes for important quotes or insights
        - Structure content in logical, scannable sections
        - Maintain professional and clear writing style
        - Ensure proper paragraph breaks for readability`,
        formatting: 'markdown'
    }
};

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

// Enhanced content generation endpoint with template support
app.post('/api/generate', async (req, res) => {
    try {
        const { prompt, template = 'default' } = req.body;

        if (!prompt) {
            return res.status(400).json({ 
                error: 'Prompt is required' 
            });
        }

        // Validate template
        if (!CONTENT_TEMPLATES[template]) {
            return res.status(400).json({ 
                error: `Invalid template. Available templates: ${Object.keys(CONTENT_TEMPLATES).join(', ')}` 
            });
        }

        const selectedTemplate = CONTENT_TEMPLATES[template];
        console.log(`Processing ${selectedTemplate.name} request for prompt length:`, prompt.length);

        // Build enhanced prompt with template-specific instructions
        const enhancedPrompt = `You are a professional content generator assistant specializing in creating well-structured, engaging content with proper Markdown formatting.

CONTENT TYPE: ${selectedTemplate.name}
FORMATTING REQUIREMENTS: ${selectedTemplate.promptModifier}

IMPORTANT FORMATTING RULES:
- Use proper Markdown syntax throughout
- Ensure all headings use # ## ### hierarchy
- Use **bold** for emphasis and key points
- Use *italics* for subtle emphasis
- Use bullet points (-) for lists
- Use > for blockquotes and important insights
- Maintain consistent formatting and professional tone
- Create scannable, well-organized content

USER REQUEST: ${prompt}

Please generate ${selectedTemplate.description.toLowerCase()} that follows the specified structure and formatting requirements. Make it professional, engaging, and properly formatted with Markdown.`;

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
                template: {
                    type: template,
                    name: selectedTemplate.name,
                    description: selectedTemplate.description,
                    formatting: selectedTemplate.formatting
                },
                model: 'gemini-pro',
                timestamp: new Date().toISOString(),
                metadata: {
                    wordCount: content.split(' ').length,
                    hasMarkdown: content.includes('#') || content.includes('**') || content.includes('*'),
                    contentType: selectedTemplate.name
                }
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

// Get available templates endpoint
app.get('/api/templates', (req, res) => {
    const templates = Object.entries(CONTENT_TEMPLATES).map(([key, template]) => ({
        id: key,
        name: template.name,
        description: template.description,
        formatting: template.formatting
    }));
    
    res.json({
        templates,
        count: templates.length,
        timestamp: new Date().toISOString()
    });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        version: '2.1.0',
        model: 'gemini-pro',
        features: [
            'secure-api-key', 
            'rate-limiting', 
            'retry-logic', 
            'template-support',
            'markdown-formatting'
        ],
        templates: Object.keys(CONTENT_TEMPLATES),
        environment: process.env.VERCEL ? 'vercel' : 'local'
    });
});

// Test endpoint
app.get('/api/test', (req, res) => {
    res.json({ 
        message: 'Enhanced Gemini API server is running!',
        timestamp: new Date().toISOString(),
        secure: true,
        templatesAvailable: Object.keys(CONTENT_TEMPLATES).length,
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
        console.log(`🚀 Enhanced Content Generator Server running on http://localhost:${PORT}`);
        console.log(`🤖 Using Google Gemini Pro API with Template Support`);
        console.log(`🔒 API key secured in backend`);
        console.log(`📝 API endpoint: http://localhost:${PORT}/api/generate`);
        console.log(`📋 Templates endpoint: http://localhost:${PORT}/api/templates`);
        console.log(`💖 Health check: http://localhost:${PORT}/api/health`);
        console.log(`🔒 Rate limiting: 15 requests per minute per IP`);
        console.log(`✨ Available templates: ${Object.keys(CONTENT_TEMPLATES).join(', ')}`);
    });
}