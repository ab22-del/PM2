#!/bin/bash
echo "Installing dependencies..."
pip install -r requirements.txt
echo ""
echo "Starting PropManage server..."
echo "Open http://localhost:8000 in your browser"
echo ""
python main.py
