# Code-Server Auto Scaling Manager

> **Intelligent AWS-powered code-server workspace management system with custom HTTPS domains**

A production-ready TypeScript application that dynamically manages EC2 instances for code-server workspaces using AWS Auto Scaling Groups, Redis state management, and Nginx reverse proxy for custom HTTPS domains.

---

> ⚠️ **NOTICE: Project In Progress & Temporarily Disabled**
>
> This project is currently **not live** due to infrastructure costs.
> If you're interested in using or testing this system, feel free to **contact me at `vinayakvispute4@gmail.com`**.
>
---


## 🚀 **Features**

### **Core Functionality**
- ✅ **On-Demand Allocation**: Instantly allocate EC2 instances to users
- ✅ **Smart Cleanup**: Automatically terminate idle instances (5+ min timeout)
- ✅ **Warm Spare Management**: Maintains ready-to-use instances for fast allocation
- ✅ **ASG-Aware Scaling**: Prevents unwanted instance replacements during cleanup
- ✅ **Instance Protection**: Protects active user instances from scale-in events
- ✅ **Custom HTTPS Domains**: Users get `https://username-abc123.workspaces.multi-coder-server.codeclause.tech`

### **Advanced Features**
- 🔄 **Auto-Scaling Integration**: Dynamically adjusts capacity based on demand
- 🛡️ **Rollback Mechanisms**: Handles allocation failures gracefully
- 📊 **Real-time Monitoring**: Health checks and system status endpoints
- 🧹 **Self-Healing**: Automatically removes broken instances from warm pool
- 🔍 **Comprehensive Logging**: Detailed operation logs for debugging
- 📈 **Cost Optimization**: Efficient resource usage with minimal waste

## 🏗️ **Architecture Overview**

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Users         │    │  Router/Manager  │    │  EC2 Instances  │
│                 │    │  (Single Server) │    │                 │
│ Request Machine │───▶│                  │───▶│ Code-Server     │
│ Custom HTTPS    │◄───│ • Express API    │    │ Workspaces      │
│ Domain          │    │ • Nginx Proxy    │    │                 │
└─────────────────┘    │ • Redis Client   │    └─────────────────┘
                       │ • AWS SDK        │             │
                       │ • Cleanup Tasks  │             │
                       └──────────────────┘             │
                                │                       │
                       ┌────────▼────────┐             │
                       │  AWS Services   │             │
                       │                 │             │
                       │ • Auto Scaling  │◄────────────┘
                       │ • EC2 Instances │
                       │ • Route53 DNS   │
                       │ • Certificate   │
                       │   Manager       │
                       └─────────────────┘
                                │
                       ┌────────▼────────┐
                       │  Redis Cache    │
                       │                 │
                       │ • User Sessions │
                       │ • Ping Tracking │
                       │ • Warm Pool     │
                       │ • Mappings      │
                       └─────────────────┘
```

## 📋 **Prerequisites**

### **AWS Requirements**
- AWS Account with programmatic access
- VPC with public subnets
- Auto Scaling Group configured for code-server instances
- EC2 instances with code-server pre-installed
- Route53 hosted zone for your domain

### **Server Requirements**
- Ubuntu/Debian server (2GB+ RAM recommended)
- Node.js 18+ 
- Redis server
- Nginx
- Domain with wildcard SSL capability

### **Skills Required**
- Basic AWS knowledge (EC2, ASG, Route53)
- Linux server administration
- Node.js/TypeScript development
- DNS and SSL certificate management

## 🛠️ **Installation & Setup**

### **1. Clone and Install**

```bash
git clone https://github.com/VinayakVispute/multi-user-code-server.git
cd code-server-manager

# Install dependencies
npm install

# Install TypeScript globally
npm install -g typescript ts-node
```

### **2. Environment Configuration**

```bash
cp .env.example .env
nano .env
```

**Required Environment Variables:**
```env
# Server Configuration
PORT=5000
NODE_ENV=production

# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key

# Auto Scaling Configuration
ASG_NAME=code-server-asg
ASG_MAX=10
WARM_SPARE_COUNT=1

# Timing Configuration
IDLE_TIMEOUT_MS=300000        # 5 minutes
CLEANUP_INTERVAL_MS=60000     # 1 minute

# Authentication
CLERK_PUBLISHABLE_KEY=your_clerk_key
CLERK_SECRET_KEY=your_clerk_secret

# Redis
REDIS_URL=redis://localhost:6379

# Domain Configuration
DOMAIN=workspaces.yourdomain.com
```

### **3. AWS Setup**

**Create Auto Scaling Group:**
```bash
# Create launch template for code-server instances
aws ec2 create-launch-template \
  --launch-template-name code-server-template \
  --launch-template-data file://launch-template.json

# Create Auto Scaling Group
aws autoscaling create-auto-scaling-group \
  --auto-scaling-group-name code-server-asg \
  --launch-template LaunchTemplateName=code-server-template \
  --min-size 0 \
  --max-size 10 \
  --desired-capacity 1 \
  --vpc-zone-identifier subnet-12345,subnet-67890
```

**Setup IAM Permissions:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "autoscaling:*",
        "ec2:*",
        "route53:*"
      ],
      "Resource": "*"
    }
  ]
}
```

### **4. SSL Certificate Setup**

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Get wildcard certificate
sudo certbot certonly --manual --preferred-challenges dns \
  -d "*.workspaces.yourdomain.com" \
  -d "workspaces.yourdomain.com"
```

### **5. Nginx Configuration**

```bash
# Install Nginx
sudo apt install nginx

# Copy configuration
sudo cp configs/nginx.conf /etc/nginx/nginx.conf

# Test and start
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl start nginx
```

### **6. Start the Application**

```bash
# Development
npm run dev

# Production
npm run build
npm start

# Using PM2 (recommended for production)
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## 🔗 **API Endpoints**

### **Machine Management**

**Allocate Machine**
```http
POST /api/machines/allocate
Authorization: Bearer <clerk-token>

Response:
{
  "success": true,
  "data": {
    "instanceId": "i-1234567890abcdef0",
    "publicUrl": "https://alice-abc123.workspaces.yourdomain.com"
  }
}
```

**System Status**
```http
GET /api/status

Response:
{
  "success": true,
  "data": {
    "activeUsers": 5,
    "warmSpares": 1,
    "totalInstances": 6,
    "asgCapacity": 6
  }
}
```

**Health Check**
```http
GET /health

Response:
{
  "status": "ok",
  "timestamp": 1640995200000,
  "uptime": 3600
}
```

### **Instance Heartbeat**

**Ping Endpoint** (called by code-server instances)
```http
POST /ping
Content-Type: application/json

{
  "instanceId": "i-1234567890abcdef0"
}
```

## 📊 **Redis Data Structure**

| Key Pattern | Type | Purpose |
|-------------|------|---------|
| `ws:{user}` | Hash | User workspace info (instanceId, publicIp, lastSeen) |
| `ws:pings` | ZSet | Track user activity timestamps |
| `ws:pool` | Set | Available warm spare instance IDs |
| `inst:{instanceId}` | String | Map instance ID to user ID |

**Example Data:**
```redis
# User workspace
HGETALL ws:alice
1) "instanceId"
2) "i-1234567890abcdef0"
3) "publicIp"
4) "13.234.55.10"
5) "customDomain"
6) "https://alice-abc123.workspaces.yourdomain.com"
7) "lastSeen"
8) "1640995200000"
9) "state"
10) "RUNNING"

# Active users by last ping time
ZRANGE ws:pings 0 -1 WITHSCORES
1) "alice"
2) "1640995200"
3) "bob"
4) "1640995180"

# Available warm spares
SMEMBERS ws:pool
1) "i-0987654321fedcba0"
2) "i-5678901234567890"
```

## 🔄 **System Workflows**

### **Machine Allocation Flow**
```
1. User requests machine via API
2. Check if user already has running machine
3. Pop warm spare from Redis pool
4. Validate instance has public IP
5. Tag instance with user ownership
6. Protect instance from ASG scale-in
7. Generate custom HTTPS subdomain
8. Create Nginx proxy configuration
9. Store allocation in Redis
10. Return custom HTTPS URL to user
```

### **Cleanup Process (Every Minute)**
```
1. Find users idle for 5+ minutes
2. Get their instance information
3. Remove instance protection
4. Remove Nginx proxy configuration
5. Safely terminate instance (decrements ASG)
6. Clean up Redis state
7. Ensure optimal warm spare count
```

### **Auto-Scaling Logic**
```
Target Capacity = Active Users + Warm Spare Count

If Current < Target:
  → Scale up ASG
  
If Current > Target AND Warm Spares > Needed:
  → Protect active instances
  → Scale down ASG (terminates unprotected instances)
```

## 🚨 **Production Considerations**

### **Monitoring & Alerts**
- Set up CloudWatch alarms for ASG scaling events
- Monitor Redis memory usage
- Track allocation success/failure rates
- Alert on cleanup failures

### **Security**
- Use IAM roles instead of access keys where possible
- Implement rate limiting on allocation endpoint
- Regularly rotate SSL certificates
- Monitor unauthorized access attempts

### **Cost Optimization**
- Adjust `IDLE_TIMEOUT_MS` based on user patterns
- Monitor EC2 instance usage patterns
- Consider spot instances for cost savings
- Review warm spare count periodically

### **High Availability**
- Deploy Redis in cluster mode
- Use multiple AZs for Auto Scaling Group
- Implement health checks for the router server
- Consider load balancer for the router if needed

## 🐛 **Troubleshooting**

### **Common Issues**

**Instance allocation fails:**
```bash
# Check ASG capacity and limits
aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names code-server-asg

# Check warm pool status
redis-cli SCARD ws:pool
```

**Nginx configuration errors:**
```bash
# Test Nginx configuration
sudo nginx -t

# Check Nginx logs
sudo tail -f /var/log/nginx/error.log

# List active configurations
ls -la /etc/nginx/sites-enabled/
```

**SSL certificate issues:**
```bash
# Check certificate expiry
sudo certbot certificates

# Renew certificates
sudo certbot renew --dry-run
```

### **Debugging Commands**

```bash
# Check system status
curl http://localhost:5000/api/status

# Monitor Redis activity
redis-cli monitor

# Check application logs
pm2 logs

# View recent allocations
redis-cli ZRANGE ws:pings 0 -1 WITHSCORES
```

## 📈 **Performance Metrics**

### **Typical Performance**
- **Allocation Time**: 2-5 seconds (warm spare)
- **Cold Start**: 60-120 seconds (new instance)
- **Cleanup Cycle**: <10 seconds
- **Concurrent Users**: 50+ (tested)

### **Resource Usage**
- **Router Server**: 1-2GB RAM, 1-2 vCPU
- **Redis**: 100-500MB RAM
- **Nginx**: Minimal overhead

## 🤝 **Contributing**

1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open Pull Request

## 📄 **License**

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 **Support**
- **Issues**: [GitHub Issues](https://github.com/yourusername/code-server-manager/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/code-server-manager/discussions)

## 🙏 **Acknowledgments**

- [Code-Server](https://github.com/coder/code-server) - VS Code in the browser
- [AWS SDK](https://aws.amazon.com/sdk-for-javascript/) - AWS JavaScript SDK
- [Redis](https://redis.io/) - In-memory data structure store
- [Nginx](https://nginx.org/) - High-performance web server
- [Clerk](https://clerk.dev/) - Authentication solution

---

**Built with ❤️ for developers who need on-demand development environments**
