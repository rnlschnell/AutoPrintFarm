#!/bin/bash

# Bambu Program Service Startup Script
# This script activates the virtual environment and starts the application

# Change to the application directory
cd /home/pi/bambu-program

# Activate the virtual environment
source venv/bin/activate

# Export Python path
export PYTHONPATH=/home/pi/bambu-program:$PYTHONPATH

# Start the application with explicit Python path
exec /home/pi/bambu-program/venv/bin/python -m uvicorn src.main:app --host 0.0.0.0 --port 8080