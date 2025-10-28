import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { getAllAgents, getAgentById, getEndpointByPath, getAllEndpoints, buildUpstreamUrl, getAgentGroups } from './agents.js';
import { generateEndpointPage, generateAgentsListPage, generateAgentDetailPage } from './templates.js';

// Load environment variables from .env file
const envResult = dotenv.config();

if (envResult.error) {
  console.log('⚠️  No .env file found, using defaults');
  console.log('💡 Create a .env file with: echo "PORT=3000" > .env');
} else {
  console.log('✅ Environment variables loaded from .env');
}

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Get PUBLIC_URL and strip any trailing slashes for clean URLs
let publicUrl = process.env.PUBLIC_URL || `http://${HOST}:${PORT}`;
const PUBLIC_URL = publicUrl.replace(/\/+$/, '');

// Helper function to get real client IP from X-Forwarded-For
function getClientIp(req) {
  // X-Forwarded-For header contains comma-separated IPs: "client, proxy1, proxy2"
  // The leftmost IP is the original client IP
  const xForwardedFor = req.headers['x-forwarded-for'];
  
  if (xForwardedFor) {
    // Split by comma and get the first IP, trim whitespace
    const ips = xForwardedFor.split(',').map(ip => ip.trim());
    return ips[0];
  }
  
  // Fallback to other headers or socket address
  return req.headers['x-real-ip'] || 
         req.ip || 
         req.socket.remoteAddress || 
         'unknown';
}

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https:", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
})); // Security headers
app.use(cors()); // Enable CORS

// Custom morgan token for real client IP
morgan.token('client-ip', (req) => getClientIp(req));

// Request logging with real client IP
app.use(morgan(':client-ip - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"'));

app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// Helper function to determine if client wants HTML
function wantsHtml(req) {
  const accept = req.headers.accept || '';
  // Check if Accept header prefers HTML over JSON
  return accept.includes('text/html') && !accept.includes('application/json');
}

// Helper function to proxy request to upstream
async function proxyToUpstream(upstreamUrl, method, queryParams, body) {
  try {
    // Build URL with query parameters
    const url = new URL(upstreamUrl);
    Object.keys(queryParams).forEach(key => {
      url.searchParams.append(key, queryParams[key]);
    });

    const options = {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'X402-Gateway/1.0'
      }
    };

    if (method === 'POST' && body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), options);
    const data = await response.json();
    
    return {
      success: true,
      statusCode: response.status,
      data: data,
      upstream: upstreamUrl
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      upstream: upstreamUrl
    };
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    runtime: 'bun',
    agents: getAllAgents().length,
    endpoints: getAllEndpoints().length
  });
});

// Root endpoint - Gateway homepage
app.get('/', (req, res) => {
  if (wantsHtml(req)) {
    // Serve a simple HTML homepage
    const agents = getAllAgents();
    const endpoints = getAllEndpoints();
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>X402 API Gateway</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        .hero {
            background: white;
            border-radius: 24px;
            padding: 60px;
            text-align: center;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
            margin-bottom: 30px;
        }
        h1 { font-size: 56px; color: #1a1a1a; margin-bottom: 20px; }
        .subtitle { font-size: 24px; color: #666; margin-bottom: 40px; }
        .cta-button {
            display: inline-block;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 18px 40px;
            border-radius: 12px;
            text-decoration: none;
            font-size: 18px;
            font-weight: 600;
            transition: transform 0.2s;
            margin: 10px;
            border: none;
            cursor: pointer;
        }
        .cta-button:hover {
            transform: translateY(-3px);
            box-shadow: 0 10px 30px rgba(102, 126, 234, 0.4);
        }
        .cta-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }
        .stats {
            display: flex;
            justify-content: center;
            gap: 40px;
            margin-top: 40px;
            padding-top: 40px;
            border-top: 2px solid #f0f0f0;
        }
        .stat { text-align: center; }
        .stat-number { font-size: 36px; font-weight: 700; color: #667eea; }
        .stat-label { color: #666; margin-top: 5px; }
        
        /* Testing Utility Styles */
        .testing-panel {
            background: white;
            border-radius: 24px;
            padding: 40px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
        }
        .testing-panel h2 {
            font-size: 32px;
            color: #1a1a1a;
            margin-bottom: 10px;
        }
        .testing-panel .description {
            color: #666;
            margin-bottom: 30px;
            font-size: 16px;
        }
        .test-controls {
            display: grid;
            gap: 20px;
            margin-bottom: 30px;
        }
        .form-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .form-group label {
            font-weight: 600;
            color: #333;
            font-size: 14px;
        }
        .form-group select,
        .form-group input {
            padding: 12px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 14px;
            font-family: 'Monaco', 'Courier New', monospace;
        }
        .form-group select:focus,
        .form-group input:focus {
            outline: none;
            border-color: #667eea;
        }
        .rate-limit-info {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 8px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }
        .rate-limit-info .label {
            color: #666;
            font-size: 14px;
        }
        .rate-limit-info .value {
            font-weight: 700;
            color: #667eea;
            font-size: 18px;
        }
        .test-output {
            background: #1e1e1e;
            color: #d4d4d4;
            padding: 20px;
            border-radius: 8px;
            font-family: 'Monaco', 'Courier New', monospace;
            font-size: 13px;
            max-height: 400px;
            overflow-y: auto;
            margin-top: 20px;
        }
        .test-output .log-entry {
            margin-bottom: 10px;
            padding-bottom: 10px;
            border-bottom: 1px solid #333;
        }
        .test-output .log-entry:last-child {
            border-bottom: none;
        }
        .test-output .timestamp {
            color: #858585;
        }
        .test-output .success {
            color: #4ec9b0;
        }
        .test-output .error {
            color: #f48771;
        }
        .test-output .info {
            color: #569cd6;
        }
        .queue-status {
            display: flex;
            gap: 20px;
            margin-bottom: 20px;
        }
        .queue-stat {
            flex: 1;
            background: #f8f9fa;
            padding: 15px;
            border-radius: 8px;
            text-align: center;
        }
        .queue-stat .number {
            font-size: 24px;
            font-weight: 700;
            color: #667eea;
        }
        .queue-stat .label {
            color: #666;
            font-size: 12px;
            margin-top: 5px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="hero">
            <h1>🚀 X402 API Gateway</h1>
            <p class="subtitle">Dynamic routing with intelligent content negotiation</p>
            <p style="color: #888; margin-bottom: 30px;">
                Access agent endpoints as beautiful documentation pages or raw JSON APIs
            </p>
            <div>
                <a href="/agents" class="cta-button">Browse Agents</a>
                <a href="/health" class="cta-button" style="background: white; color: #667eea; border: 2px solid #667eea;">Health Check</a>
            </div>
            <div class="stats">
                <div class="stat">
                    <div class="stat-number">${agents.length}</div>
                    <div class="stat-label">Agents</div>
                </div>
                <div class="stat">
                    <div class="stat-number">${endpoints.length}</div>
                    <div class="stat-label">Endpoints</div>
                </div>
                <div class="stat">
                    <div class="stat-number">⚡</div>
                    <div class="stat-label">Bun Powered</div>
                </div>
            </div>
        </div>

        <div class="testing-panel">
            <h2>🧪 Endpoint Tester</h2>
            <p class="description">Test x402 endpoints or any web URL with built-in rate limiting for free tier usage</p>
            
            <div class="rate-limit-info">
                <div>
                    <div class="label">Rate Limit</div>
                    <div class="value" id="rateLimit">10 req/min</div>
                </div>
                <div>
                    <div class="label">Requests Made</div>
                    <div class="value" id="requestCount">0</div>
                </div>
                <div>
                    <div class="label">Queue Size</div>
                    <div class="value" id="queueSize">0</div>
                </div>
            </div>

            <div class="test-controls">
                <div class="form-group">
                    <label for="endpointMode">Endpoint Mode</label>
                    <select id="endpointMode" onchange="toggleEndpointMode()">
                        <option value="preset">Preset x402 Endpoints</option>
                        <option value="custom">Custom URL (Any Web URL)</option>
                    </select>
                </div>

                <div class="form-group" id="presetGroup">
                    <label for="endpoint">Select Endpoint</label>
                    <select id="endpoint">
                        <option value="">Choose an endpoint...</option>
                        ${endpoints.map(ep => {
                            const method = Array.isArray(ep.method) ? ep.method[0] : ep.method;
                            const methodDisplay = Array.isArray(ep.method) ? ep.method.join('/') : ep.method;
                            return `
                            <option value="${ep.path}" data-method="${method}">
                                ${ep.agentIcon} ${ep.agentName} - ${ep.name} (${methodDisplay})
                            </option>
                        `;
                        }).join('')}
                    </select>
                </div>

                <div class="form-group" id="customGroup" style="display: none;">
                    <label for="customUrl">Custom URL</label>
                    <input type="text" id="customUrl" placeholder="https://api.example.com/endpoint" style="width: 100%;">
                </div>

                <div class="form-group" id="customMethodGroup" style="display: none;">
                    <label for="customMethod">HTTP Method</label>
                    <select id="customMethod">
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                        <option value="DELETE">DELETE</option>
                        <option value="PATCH">PATCH</option>
                    </select>
                </div>

                <div class="form-group">
                    <label for="rateLimitInput">Rate Limit (requests per minute)</label>
                    <input type="number" id="rateLimitInput" value="10" min="1" max="60">
                </div>

                <div style="display: flex; gap: 10px;">
                    <button class="cta-button" onclick="testEndpoint()" id="testBtn">
                        ▶️ Test Endpoint
                    </button>
                    <button class="cta-button" onclick="testAllEndpoints()" id="testAllBtn">
                        🔄 Test All Endpoints
                    </button>
                    <button class="cta-button" onclick="clearLogs()" style="background: #dc3545;">
                        🗑️ Clear Logs
                    </button>
                </div>
            </div>

            <div class="test-output" id="output">
                <div class="log-entry">
                    <span class="info">Ready to test endpoints. Select an endpoint and click "Test Endpoint".</span>
                </div>
            </div>
        </div>
    </div>

    <script>
        let requestQueue = [];
        let requestCount = 0;
        let isProcessing = false;
        let requestsThisMinute = 0;
        let minuteStartTime = Date.now();

        function toggleEndpointMode() {
            const mode = document.getElementById('endpointMode').value;
            const presetGroup = document.getElementById('presetGroup');
            const customGroup = document.getElementById('customGroup');
            const customMethodGroup = document.getElementById('customMethodGroup');
            const testAllBtn = document.getElementById('testAllBtn');

            if (mode === 'custom') {
                presetGroup.style.display = 'none';
                customGroup.style.display = 'flex';
                customMethodGroup.style.display = 'flex';
                testAllBtn.style.display = 'none';
            } else {
                presetGroup.style.display = 'flex';
                customGroup.style.display = 'none';
                customMethodGroup.style.display = 'none';
                testAllBtn.style.display = 'inline-block';
            }
        }

        function log(message, type = 'info') {
            const output = document.getElementById('output');
            const timestamp = new Date().toLocaleTimeString();
            const entry = document.createElement('div');
            entry.className = 'log-entry';
            entry.innerHTML = \`
                <span class="timestamp">[\${timestamp}]</span> 
                <span class="\${type}">\${message}</span>
            \`;
            output.appendChild(entry);
            output.scrollTop = output.scrollHeight;
        }

        function updateStats() {
            document.getElementById('requestCount').textContent = requestCount;
            document.getElementById('queueSize').textContent = requestQueue.length;
            const rateLimit = document.getElementById('rateLimitInput').value;
            document.getElementById('rateLimit').textContent = \`\${rateLimit} req/min\`;
        }

        function clearLogs() {
            document.getElementById('output').innerHTML = '';
            log('Logs cleared.', 'info');
        }

        async function makeRequest(endpoint, method) {
            try {
                const response = await fetch(endpoint, {
                    method: method,
                    headers: {
                        'Accept': 'application/json'
                    }
                });

                const data = await response.json();
                
                if (response.ok) {
                    log(\`✓ SUCCESS [\${method}] \${endpoint} - Status: \${response.status}\`, 'success');
                    log(\`Response: \${JSON.stringify(data).substring(0, 200)}...\`, 'info');
                } else {
                    log(\`✗ ERROR [\${method}] \${endpoint} - Status: \${response.status}\`, 'error');
                    log(\`Error: \${JSON.stringify(data)}\`, 'error');
                }
                
                requestCount++;
                requestsThisMinute++;
                updateStats();
            } catch (error) {
                log(\`✗ FAILED [\${method}] \${endpoint} - \${error.message}\`, 'error');
                requestCount++;
                updateStats();
            }
        }

        async function processQueue() {
            if (isProcessing || requestQueue.length === 0) {
                return;
            }

            isProcessing = true;
            const rateLimit = parseInt(document.getElementById('rateLimitInput').value);
            
            // Reset minute counter if a minute has passed
            const now = Date.now();
            if (now - minuteStartTime >= 60000) {
                requestsThisMinute = 0;
                minuteStartTime = now;
            }

            while (requestQueue.length > 0) {
                // Check if we've hit the rate limit
                if (requestsThisMinute >= rateLimit) {
                    const waitTime = 60000 - (Date.now() - minuteStartTime);
                    log(\`⏸️ Rate limit reached. Waiting \${Math.ceil(waitTime / 1000)}s before continuing...\`, 'info');
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    requestsThisMinute = 0;
                    minuteStartTime = Date.now();
                }

                const { endpoint, method } = requestQueue.shift();
                updateStats();
                
                await makeRequest(endpoint, method);
                
                // Add delay between requests (at least 60000/rateLimit ms)
                const delayBetweenRequests = Math.ceil(60000 / rateLimit);
                if (requestQueue.length > 0) {
                    await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
                }
            }

            isProcessing = false;
            log('✓ Queue processing complete.', 'success');
            updateStats();
        }

        function testEndpoint() {
            const mode = document.getElementById('endpointMode').value;
            let endpoint, method;

            if (mode === 'custom') {
                endpoint = document.getElementById('customUrl').value.trim();
                method = document.getElementById('customMethod').value;

                if (!endpoint) {
                    log('⚠️ Please enter a custom URL.', 'error');
                    return;
                }

                // Validate URL format
                try {
                    new URL(endpoint);
                } catch (e) {
                    log('⚠️ Invalid URL format. Please enter a valid URL (e.g., https://api.example.com/endpoint)', 'error');
                    return;
                }
            } else {
                const select = document.getElementById('endpoint');
                endpoint = select.value;
                
                if (!endpoint) {
                    log('⚠️ Please select an endpoint first.', 'error');
                    return;
                }

                method = select.options[select.selectedIndex].dataset.method;
            }
            
            log(\`📋 Adding to queue: [\${method}] \${endpoint}\`, 'info');
            requestQueue.push({ endpoint, method });
            updateStats();
            processQueue();
        }

        function testAllEndpoints() {
            const select = document.getElementById('endpoint');
            const options = Array.from(select.options).slice(1); // Skip the first "Choose..." option
            
            if (options.length === 0) {
                log('⚠️ No endpoints available.', 'error');
                return;
            }

            log(\`📋 Adding all \${options.length} endpoints to queue...\`, 'info');
            
            options.forEach(option => {
                const endpoint = option.value;
                const method = option.dataset.method;
                requestQueue.push({ endpoint, method });
            });
            
            updateStats();
            processQueue();
        }

        // Initialize stats
        updateStats();
    </script>
</body>
</html>`;
    res.send(html);
  } else {
    res.json({
      message: 'X402 API Gateway',
      version: '1.0.0',
      description: 'Dynamic routing with content negotiation',
      agents: getAllAgents().length,
      endpoints: getAllEndpoints().length,
      links: {
        health: '/health',
        agents: '/agents',
        documentation: 'Visit any endpoint with Accept: text/html header'
      }
    });
  }
});

// List all agents
app.get('/agents', (req, res) => {
  const agents = getAllAgents();
  
  if (wantsHtml(req)) {
    const html = generateAgentsListPage(agents, PUBLIC_URL);
    res.send(html);
  } else {
    res.json({
      agents: agents.map(agent => {
        // Count all endpoints across all groups (groups are internal only)
        const endpointCount = (agent.groups || []).reduce((total, group) => 
          total + group.endpoints.length, 0
        );
        return {
          id: agent.id,
          name: agent.name,
          description: agent.description,
          icon: agent.icon,
          endpointCount: endpointCount,
          link: `/agents/${agent.id}`
        };
      })
    });
  }
});

// Get specific agent details
app.get('/agents/:agentId', (req, res) => {
  const agent = getAgentById(req.params.agentId);
  
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  if (wantsHtml(req)) {
    const html = generateAgentDetailPage(agent, PUBLIC_URL);
    res.send(html);
  } else {
    // Flatten endpoints from all groups - groups are internal only
    const endpoints = [];
    for (const group of (agent.groups || [])) {
      for (const ep of group.endpoints) {
        endpoints.push({
          id: ep.id,
          name: ep.name,
          description: ep.description,
          path: ep.path,
          method: ep.method,
          link: ep.path
        });
      }
    }
    
    res.json({
      agent: {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        icon: agent.icon,
        endpoints: endpoints.map(ep => ({
          ...ep,
          method: Array.isArray(ep.method) ? ep.method : [ep.method]
        }))
      }
    });
  }
});

// Dynamic endpoint handler - handles all agent endpoints
app.all('*', async (req, res, next) => {
  const result = getEndpointByPath(req.path);
  
  if (!result) {
    return next(); // Pass to 404 handler
  }
  
  const { agent, group, endpoint } = result;
  
  // Check if request method matches
  const allowedMethods = Array.isArray(endpoint.method) ? endpoint.method : [endpoint.method];
  if (!allowedMethods.includes(req.method)) {
    return res.status(405).json({
      error: 'Method Not Allowed',
      message: `This endpoint only accepts ${allowedMethods.join(', ')} requests`,
      endpoint: endpoint.path,
      allowedMethods: allowedMethods
    });
  }
  
  // Content negotiation - HTML or JSON
  if (wantsHtml(req)) {
    // Serve product description page
    const html = generateEndpointPage(agent, endpoint, PUBLIC_URL);
    res.send(html);
  } else {
    // Proxy to upstream and return JSON
    const queryParams = req.query || {};
    const body = req.body || {};
    
    // Build full upstream URL from group baseUrl + endpoint upstreamUrl
    const fullUpstreamUrl = buildUpstreamUrl(group, endpoint);
    
    // Use the actual request method (already validated above)
    console.log(`Proxying ${req.method} request to: ${fullUpstreamUrl}`);
    console.log(`  Agent: ${agent.name}, Group: ${group.name}`);
    if (Object.keys(queryParams).length > 0) {
      console.log(`  Query Params:`, queryParams);
    }
    if (req.method === 'POST' && Object.keys(body).length > 0) {
      console.log(`  Body:`, body);
    }
    
    const proxyResult = await proxyToUpstream(
      fullUpstreamUrl,
      req.method,
      queryParams,
      body
    );
    
    if (proxyResult.success) {
      res.status(proxyResult.statusCode).json({
        endpoint: endpoint.path,
        agent: agent.name,
        timestamp: new Date().toISOString(),
        ...proxyResult.data
      });
    } else {
      res.status(502).json({
        error: 'Bad Gateway',
        message: 'Failed to proxy request to upstream service',
        details: proxyResult.error,
        endpoint: endpoint.path,
        upstream: proxyResult.upstream
      });
    }
  }
});

// 404 handler
app.use((req, res) => {
  if (wantsHtml(req)) {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>404 - Not Found</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .error-box {
            background: white;
            border-radius: 16px;
            padding: 60px;
            text-align: center;
            max-width: 600px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
        }
        .error-code { font-size: 72px; font-weight: 700; color: #667eea; margin-bottom: 20px; }
        h1 { font-size: 32px; color: #1a1a1a; margin-bottom: 15px; }
        p { color: #666; font-size: 16px; margin-bottom: 30px; }
        .home-link {
            display: inline-block;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 15px 30px;
            border-radius: 8px;
            text-decoration: none;
            font-weight: 600;
            transition: transform 0.2s;
        }
        .home-link:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 20px rgba(102, 126, 234, 0.4);
        }
    </style>
</head>
<body>
    <div class="error-box">
        <div class="error-code">404</div>
        <h1>Page Not Found</h1>
        <p>The route <code>${req.url}</code> doesn't exist on this server.</p>
        <a href="/" class="home-link">Go Home</a>
    </div>
</body>
</html>`;
    res.status(404).send(html);
  } else {
    res.status(404).json({
      error: 'Not Found',
      message: `Route ${req.url} not found`,
      method: req.method,
      availableEndpoints: getAllEndpoints().map(ep => ep.path)
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on http://${HOST}:${PORT}`);
  console.log(`🌐 Public URL: ${PUBLIC_URL}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`⚡ Runtime: Bun ${Bun.version}`);
  console.log(`📊 Process ID: ${process.pid}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  process.exit(0);
});

