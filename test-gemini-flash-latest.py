#!/usr/bin/env python3
"""Test gemini-flash-latest model"""
import requests
import json

API_KEY = "AIzaSyAFtBsBClS3PgCMaJUIJAif3ln6-1eJqjU"
MODEL = "gemini-flash-latest"

url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={API_KEY}"
payload = {"contents": [{"parts": [{"text": "Hello"}]}]}

print(f"\nTest du modèle: {MODEL}")
print("=" * 50)

try:
    response = requests.post(url, json=payload, timeout=10)
    print(f"Status: {response.status_code}")
    
    if response.status_code == 200:
        data = response.json()
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        print(f"\n✅ SUCCÈS ! Le modèle fonctionne !")
        print(f"\nRéponse: {text}\n")
    else:
        print(f"\n❌ ERREUR {response.status_code}")
        error = response.json()
        if "error" in error:
            print(f"Message: {error['error'].get('message', '')[:200]}")
            if "limit: 0" in str(error):
                print("\n⚠️  Quota à zéro pour ce modèle aussi")
        print()
        
except Exception as e:
    print(f"\n❌ Exception: {e}\n")
