# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PrintFarmSoftware is a comprehensive 3D printer farm management system designed for Bambu Lab printers, running on Raspberry Pi hardware.

### System Components
- **Backend**: Python 3.11 FastAPI service providing REST API and WebSocket endpoints
- **Frontend**: React 18.3 TypeScript application with Vite build system and shadcn/ui components
- **Database**: Hybrid architecture with local SQLite for operations and Supabase for cloud backup
- **Hardware**: Production deployment on Raspberry Pi at 192.168.4.45:8080

## Development Environment - SSH Key Authentication Required

**IMPORTANT: SSH key authentication must be set up for passwordless development workflow**

### One-Time SSH Key Setup

If not already configured, set up SSH key authentication:

```bash
# 1. Generate SSH key pair (if not exists)
ssh-keygen -t ed25519 -C "your_email" -N "" -f ~/.ssh/id_ed25519

# 2. Copy public key to Pi (will ask for password ONE last time)
cat ~/.ssh/id_ed25519.pub | ssh pi@192.168.4.45 "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"

# 3. Test passwordless connection
ssh pi@192.168.4.45 "echo 'SSH key authentication successful!'"
```

After setup, all SSH and SCP commands work without password prompts.

## Development Workflow - Pi-First with Passwordless Deploy

**IMPORTANT: Pi is the source of truth. Always copy files from Pi before editing to ensure you have the latest version**

### Development Locations
```bash
# Pi location (SOURCE OF TRUTH)
pi@192.168.4.45:/home/pi/PrintFarmSoftware

# Local copy for editing
C:\Users\nlsch\PrintFarmSoftware-local\
```

### Simple 4-Step Workflow
1. **COPY** - Copy file(s) from Pi to local (overwrite local version)
2. **EDIT** - Make changes locally using proper tools with Windows paths
3. **DEPLOY** - Copy changed files to Pi using scp with absolute paths
4. **VERIFY** - Check Pi to confirm changes were deployed successfully

## Common Development Commands

### Frontend Development (Pi-native)
```bash
cd frontend

# Dependencies
npm install                 # Install dependencies (if needed)

# Development
npm run dev                # Dev server on http://192.168.4.45:5173 (for testing)
npm run build              # Production build to dist/
npm run lint               # ESLint checking
npm run preview            # Preview production build

# Type checking (critical before commits)
npx tsc --noEmit          # Verify TypeScript types
```

### Backend Development
```bash
# Run development server
python src/main.py         # API docs at http://192.168.4.45:8080/docs

# Run tests
python -m pytest test_*.py -v
python test_integration.py
python test_live_websocket.py
```

### Service Management
```bash
# Service control (all passwordless with SSH keys)
ssh pi@192.168.4.45 "sudo systemctl start bambu-program"
ssh pi@192.168.4.45 "sudo systemctl stop bambu-program"
ssh pi@192.168.4.45 "sudo systemctl restart bambu-program"
ssh pi@192.168.4.45 "sudo systemctl status bambu-program"

# View logs
ssh pi@192.168.4.45 "sudo journalctl -u bambu-program -f"
ssh pi@192.168.4.45 "sudo journalctl -u bambu-program --since '1 hour ago'"
```

## Pi-First Development Process

### How to Make Changes

1. **Copy File(s) from Pi to Local (ALWAYS FIRST)**
   ```bash
   # Copy a single file from Pi (overwrites local)
   scp pi@192.168.4.45:/home/pi/PrintFarmSoftware/frontend/src/hooks/useProductsNew.ts "C:\Users\nlsch\PrintFarmSoftware-local\frontend\src\hooks\useProductsNew.ts"

   # Copy entire directory from Pi (overwrites local)
   scp -r pi@192.168.4.45:/home/pi/PrintFarmSoftware/frontend/src/ "C:\Users\nlsch\PrintFarmSoftware-local\frontend\src\"
   ```

2. **Edit Files Locally**
   - Use Read/Edit/Write tools on files in `C:\Users\nlsch\PrintFarmSoftware-local\`
   - Use Windows-style paths with proper escaping (absolute paths)
   - All standard tools work perfectly with local files
   - Fast, reliable editing experience

3. **Deploy to Pi (Passwordless)**
   ```bash
   # Deploy a single file (use absolute paths)
   scp "C:\Users\nlsch\PrintFarmSoftware-local\frontend\src\hooks\useProductsNew.ts" pi@192.168.4.45:/home/pi/PrintFarmSoftware/frontend/src/hooks/

   # Deploy entire directory (use absolute paths)
   scp -r "C:\Users\nlsch\PrintFarmSoftware-local\frontend\src\" pi@192.168.4.45:/home/pi/PrintFarmSoftware/frontend/src/
   ```

4. **Verify Deployment**
   ```bash
   # Verify file was updated on Pi
   ssh pi@192.168.4.45 "cat /home/pi/PrintFarmSoftware/frontend/src/hooks/useProductsNew.ts | head -20"

   # Or check modification time
   ssh pi@192.168.4.45 "ls -lh /home/pi/PrintFarmSoftware/frontend/src/hooks/useProductsNew.ts"
   ```

5. **Build and Test on Pi (Passwordless)**
   ```bash
   # Frontend: Build after deployment
   ssh pi@192.168.4.45 "cd /home/pi/PrintFarmSoftware/frontend && npm run build"

   # Backend: Restart service after deployment
   ssh pi@192.168.4.45 "sudo systemctl restart bambu-program"

   # Test at http://192.168.4.45:8080
   ```

## Workflow Examples

### Frontend Changes
```bash
# 1. Copy from Pi to local (get latest version)
scp pi@192.168.4.45:/home/pi/PrintFarmSoftware/frontend/src/components/Header.tsx "C:\Users\nlsch\PrintFarmSoftware-local\frontend\src\components\Header.tsx"

# 2. Edit locally using Read/Edit/Write tools
# Make changes in C:\Users\nlsch\PrintFarmSoftware-local\frontend\src\components\Header.tsx

# 3. Deploy to Pi (use absolute path)
scp "C:\Users\nlsch\PrintFarmSoftware-local\frontend\src\components\Header.tsx" pi@192.168.4.45:/home/pi/PrintFarmSoftware/frontend/src/components/

# 4. Verify deployment
ssh pi@192.168.4.45 "cat /home/pi/PrintFarmSoftware/frontend/src/components/Header.tsx | head -20"

# 5. Build on Pi
ssh pi@192.168.4.45 "cd /home/pi/PrintFarmSoftware/frontend && npm run build"

# 6. Test at http://192.168.4.45:8080
# No service restart needed - FastAPI serves from dist/ automatically
```

### Backend Changes
```bash
# 1. Copy from Pi to local (get latest version)
scp pi@192.168.4.45:/home/pi/PrintFarmSoftware/src/api/products.py "C:\Users\nlsch\PrintFarmSoftware-local\src\api\products.py"

# 2. Edit locally using Read/Edit/Write tools
# Make changes in C:\Users\nlsch\PrintFarmSoftware-local\src\api\products.py

# 3. Deploy to Pi (use absolute path)
scp "C:\Users\nlsch\PrintFarmSoftware-local\src\api\products.py" pi@192.168.4.45:/home/pi/PrintFarmSoftware/src/api/

# 4. Verify deployment
ssh pi@192.168.4.45 "cat /home/pi/PrintFarmSoftware/src/api/products.py | head -20"

# 5. Restart service on Pi
ssh pi@192.168.4.45 "sudo systemctl restart bambu-program"

# 6. Check service status
ssh pi@192.168.4.45 "sudo systemctl status bambu-program"

# 7. Test at http://192.168.4.45:8080/docs
```

## Important Tips for Pi-First Development

1. **SSH keys are required** - Set up once, never type passwords again
2. **Pi is source of truth** - Always copy from Pi first to get latest version
3. **Always verify deployment** - Check Pi files after deployment to confirm changes
4. **Use absolute paths** - Windows paths must be absolute with proper escaping in quotes
5. **Edit locally, deploy to Pi** - All editing happens in local copy after copying from Pi
6. **Test immediately** - Check changes at http://192.168.4.45:8080
7. **Frontend builds take ~30 seconds** - Be patient after deployment
8. **Deploy specific files** - Only copy what you changed to minimize transfer time
9. **Use proper tools** - Read/Edit/Write work perfectly with local files
10. **Fast iteration** - No password prompts = smooth workflow

## Quick Reference Commands

```bash
# Copy file from Pi to local (get latest version)
scp pi@192.168.4.45:/home/pi/PrintFarmSoftware/path/to/file.py "C:\Users\nlsch\PrintFarmSoftware-local\path\to\file.py"

# Read a file from Pi
ssh pi@192.168.4.45 "cat /path/to/file"

# List directory contents on Pi
ssh pi@192.168.4.45 "ls -la /home/pi/PrintFarmSoftware/frontend/src/components/"

# Check if a file exists on Pi
ssh pi@192.168.4.45 "test -f /path/to/file && echo 'exists' || echo 'not found'"

# Create a backup on Pi
ssh pi@192.168.4.45 "cp /path/to/file /path/to/file.bak"

# Restore from backup on Pi
ssh pi@192.168.4.45 "mv /path/to/file.bak /path/to/file"

# Complete workflow: Copy, deploy, verify, and build (frontend)
scp pi@192.168.4.45:/home/pi/PrintFarmSoftware/frontend/src/components/Header.tsx "C:\Users\nlsch\PrintFarmSoftware-local\frontend\src\components\Header.tsx" && scp "C:\Users\nlsch\PrintFarmSoftware-local\frontend\src\components\Header.tsx" pi@192.168.4.45:/home/pi/PrintFarmSoftware/frontend/src/components/ && ssh pi@192.168.4.45 "cat /home/pi/PrintFarmSoftware/frontend/src/components/Header.tsx | head -5" && ssh pi@192.168.4.45 "cd /home/pi/PrintFarmSoftware/frontend && npm run build"

# Complete workflow: Copy, deploy, verify, and restart (backend)
scp pi@192.168.4.45:/home/pi/PrintFarmSoftware/src/api/products.py "C:\Users\nlsch\PrintFarmSoftware-local\src\api\products.py" && scp "C:\Users\nlsch\PrintFarmSoftware-local\src\api\products.py" pi@192.168.4.45:/home/pi/PrintFarmSoftware/src/api/ && ssh pi@192.168.4.45 "cat /home/pi/PrintFarmSoftware/src/api/products.py | head -5" && ssh pi@192.168.4.45 "sudo systemctl restart bambu-program"
```

## Critical Development Principles

### 1. SSH Key Authentication First
Before any development work, ensure SSH key authentication is configured. This eliminates all password prompts and enables smooth workflow.

### 2. Pi is Source of Truth
**ALWAYS** copy files from Pi to local before editing. The Pi has the most recent, running code. Never assume your local copy is up to date.

### 3. Pi-First Development Workflow
1. Copy file(s) from Pi to local (overwrites local version)
2. Edit files locally using Read/Edit/Write tools with absolute Windows paths
3. Deploy to Pi using scp with absolute paths
4. **VERIFY deployment** by checking the file on Pi
5. Build/restart and test

### 4. Always Verify Deployment
After deploying, **ALWAYS** verify the changes were applied on Pi. Sometimes deployments fail silently. Use `cat | head` or `ls -lh` to confirm.

### 5. Use Absolute Paths with Proper Escaping
Always use absolute paths for Windows and wrap in quotes for proper escaping:
- `"C:\Users\nlsch\PrintFarmSoftware-local\path\to\file.py"`

### 6. Test on Target Hardware
All testing happens on the Pi at http://192.168.4.45:8080, ensuring real printer connectivity and accurate environment.

### 7. Deploy Only What Changes
Use scp to copy only the specific files you've modified to minimize transfer time.

### 8. Follow Existing Patterns
Study neighboring files and existing implementations before adding new features. Maintain consistency with established patterns.

### 9. Never Edit Directly on Pi
Always edit locally and deploy. Direct editing on Pi breaks the Pi-First workflow and causes version conflicts.
