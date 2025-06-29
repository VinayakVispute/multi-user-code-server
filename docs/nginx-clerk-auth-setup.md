# Setting up nginx `auth_request` with Clerk Authentication

This guide explains how to set up nginx `auth_request` with Clerk authentication for your multi-user code-server platform.

## Overview

The setup involves:

1. **Express Server**: Validates Clerk authentication tokens
2. **nginx**: Uses `auth_request` to check authentication before serving content
3. **Frontend**: Handles redirects and authentication flow

## Architecture Flow

```
User Request → nginx → auth_request to Express → Clerk Validation → Allow/Deny → Serve Content
```

## 1. Express Server Setup

### A. Environment Variables

Add these to your `.env` file:

```env
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
PORT=3000
```

### B. Authentication Endpoint

The Express server now includes `/auth/validate` endpoint that:

- Validates Clerk session tokens
- Returns user information in headers
- Responds with appropriate HTTP status codes

### C. Updated Endpoints

- **`/auth/validate`**: For nginx auth_request validation
- **`/ping`**: Now requires authentication (was `/heartbeat` in nginx)
- **`/health`**: Public health check (no auth required)

## 2. nginx Configuration

### A. Key Components

#### Upstream Server

```nginx
upstream auth_server {
    server YOUR_EXPRESS_SERVER_IP:3000;
}
```

#### Auth Request Location

```nginx
location = /auth {
    internal;
    proxy_pass http://auth_server/auth/validate;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";

    # Pass authentication headers
    proxy_set_header Cookie $http_cookie;
    proxy_set_header Authorization $http_authorization;
}
```

#### Protected Locations

```nginx
location / {
    auth_request /auth;
    auth_request_set $user_id $upstream_http_x_user_id;
    # ... proxy to code-server
}
```

### B. Variables You Must Replace

1. **`YOUR_EXPRESS_SERVER_IP:3000`**: Replace with your actual Express server address
2. **`YOUR_FRONTEND_URL`**: Replace with your frontend URL for auth redirects

## 3. Frontend Integration

### A. Authentication Flow

1. User accesses code-server URL
2. nginx makes auth_request to Express
3. If authentication fails → redirect to `/auth/sign-in`
4. User logs in via Clerk
5. Successful login → redirect back to code-server

### B. Heartbeat Script

The heartbeat script now:

- Uses relative URLs (served from same domain)
- Includes proper error handling
- Redirects to login on auth failure
- Runs every 30 seconds (configurable)

## 4. Deployment Steps

### Step 1: Update Express Server

1. The server code has been updated with authentication endpoints
2. Deploy the updated server code
3. Ensure environment variables are set

### Step 2: Update nginx Configuration

1. Replace the nginx configuration with the new version
2. Update the IP addresses and URLs as needed
3. Reload nginx: `sudo nginx -s reload`

### Step 3: Test the Setup

1. **Test health endpoint**: `curl http://your-domain/health`
2. **Test auth without login**: Should redirect to login page
3. **Test auth with login**: Should access code-server

## 5. Security Considerations

### A. HTTPS in Production

```nginx
server {
    listen 443 ssl;
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    # ... rest of config
}
```

### B. Rate Limiting

```nginx
http {
    limit_req_zone $binary_remote_addr zone=auth:10m rate=10r/m;

    server {
        location = /auth {
            limit_req zone=auth burst=5 nodelay;
            # ... rest of auth config
        }
    }
}
```

### C. Timeout Configuration

```nginx
location = /auth {
    proxy_connect_timeout 5s;
    proxy_read_timeout 5s;
    proxy_send_timeout 5s;
}
```

## 6. Troubleshooting

### Common Issues

1. **502 Bad Gateway**: Check if Express server is running and accessible
2. **Auth loops**: Verify Clerk session tokens are being passed correctly
3. **CORS issues**: Ensure CORS is configured properly in Express

### Debug Headers

Add debug headers to see what's happening:

```nginx
add_header X-Debug-User-ID $user_id;
add_header X-Debug-Auth-Status $upstream_status;
```

### Logs to Check

1. **nginx error log**: `/var/log/nginx/error.log`
2. **Express console**: Check your Express server logs
3. **Browser network tab**: Check for failed requests

## 7. Advanced Configuration

### A. Caching Auth Responses

```nginx
location = /auth {
    proxy_cache auth_cache;
    proxy_cache_valid 200 1m;
    proxy_cache_key "$request_method$request_uri$http_cookie";
}
```

### B. Multiple Auth Providers

You can extend this to support multiple auth providers by creating different auth endpoints.

### C. Role-Based Access

Extend the Express auth endpoint to return role information and use it in nginx:

```nginx
auth_request_set $user_role $upstream_http_x_user_role;
# Use $user_role for conditional access
```

## 8. Environment-Specific Notes

### Development

- Use HTTP for simplicity
- Enable debug headers
- Use localhost addresses

### Production

- Always use HTTPS
- Remove debug headers
- Use proper domain names
- Implement rate limiting
- Set up monitoring

## Next Steps

1. Test the authentication flow thoroughly
2. Set up monitoring and alerting
3. Implement user session management in Redis
4. Add role-based access control if needed
5. Set up SSL/TLS certificates for production
