# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PrintFarmSoftware is a comprehensive 3D printer farm management system designed for Bambu Lab printers, running on Raspberry Pi hardware.

### System Components
- **Backend**: Python 3.11 FastAPI service providing REST API and WebSocket endpoints
- **Frontend**: React 18.3 TypeScript application with Vite build system and shadcn/ui components
- **Database**: Hybrid architecture with local SQLite for operations and Supabase for cloud backup
- **Hardware**: Production deployment on Raspberry Pi at 192.168.4.45:8080

## Development Environment

**All development now happens directly on the Raspberry Pi at 192.168.4.45**

### SSH Development Setup
```bash
ssh pi@192.168.4.45
cd /home/pi/PrintFarmSoftware
```

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

### Deployment Workflow (Simplified)

**Standard Development Process:**
```bash
# 1. Make changes directly on Pi
ssh pi@192.168.4.45
cd /home/pi/PrintFarmSoftware

# 2. Edit files (example)
nano frontend/src/components/SomeComponent.tsx

# 3. Build frontend
cd frontend && npm run build && cd ..

# 4. Test changes
# Frontend is automatically served from dist/ by FastAPI

# 5. Restart service to apply backend changes (if any)
sudo systemctl restart bambu-program

# 6. Commit changes
git add .
git commit -m "Descriptive message"
git push origin development
```

### Service Management
```bash
# Service control
sudo systemctl start bambu-program
sudo systemctl stop bambu-program
sudo systemctl restart bambu-program
sudo systemctl status bambu-program

# View logs
sudo journalctl -u bambu-program -f
sudo journalctl -u bambu-program --since "1 hour ago"
```

## File Editing for Claude Code

**Simple Pi-based approach:**

```bash
# Read files on Pi
ssh pi@192.168.4.45 "cat /home/pi/PrintFarmSoftware/frontend/src/hooks/usePrinters.ts"

# Edit files on Pi
ssh pi@192.168.4.45 "cat > /home/pi/PrintFarmSoftware/frontend/src/hooks/usePrinters.ts << 'FILEEOF'
// New file content here
FILEEOF"

# Build and deploy
ssh pi@192.168.4.45 "cd /home/pi/PrintFarmSoftware/frontend && npm run build"
ssh pi@192.168.4.45 "sudo systemctl restart bambu-program"
```

## Critical Development Principles

### 1. Pi-Only Development
All development happens directly on the Raspberry Pi via SSH. The Pi has proven capable of building the frontend (processes 2700+ modules in ~25 seconds).

### 2. Type Safety is Required
Run `npx tsc --noEmit` before any deployment. TypeScript errors must be resolved.

### 3. Test on Target Hardware
Development happens directly on production hardware, providing immediate feedback and real printer testing.

### 4. Commit Everything to GitHub
All changes must be committed to the `development` branch. Never leave uncommitted work.

### 5. Follow Existing Patterns
Study neighboring files and existing implementations before adding new features. Maintain consistency with established patterns.
