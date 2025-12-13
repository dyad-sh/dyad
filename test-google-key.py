#!/usr/bin/env python3
"""
Script rapide pour tester la clé API Google Gemini
"""
import requests
import json
import sys

# Configuration
API_KEY = "AIzaSyAFtBsBClS3PgCMaJUIJAif3ln6-1eJqjU"
MODEL = "gemini-2.0-flash-exp"
API_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"

def test_google_api():
    """Test la clé API Google Gemini"""
    
    print("=" * 60)
    print("  Test de la Clé API Google Gemini")
    print("=" * 60)
    print()
    print(f"Modèle: {MODEL}")
    print(f"Clé API: {API_KEY[:20]}...")
    print()
    
    # Préparer la requête
    url = f"{API_URL}?key={API_KEY}"
    headers = {
        "Content-Type": "application/json"
    }
    
    payload = {
        "contents": [
            {
                "parts": [
                    {
                        "text": "Hello, this is a test message. Please respond with 'OK'."
                    }
                ]
            }
        ]
    }
    
    print("Envoi de la requête à Google API...")
    print()
    
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=10)
        
        print(f"Status Code: {response.status_code}")
        print()
        
        if response.status_code == 200:
            # Succès
            data = response.json()
            if "candidates" in data and len(data["candidates"]) > 0:
                text = data["candidates"][0]["content"]["parts"][0]["text"]
                print("✅ SUCCÈS ! La clé fonctionne !")
                print()
                print(f"Réponse de Gemini: {text}")
                print()
                return True
            else:
                print("⚠️  Réponse inattendue:")
                print(json.dumps(data, indent=2))
                return False
                
        elif response.status_code == 429:
            # Quota dépassé
            print("❌ ERREUR: Quota dépassé (429)")
            print()
            try:
                error_data = response.json()
                print("Détails de l'erreur:")
                print(json.dumps(error_data, indent=2))
                
                if "error" in error_data:
                    message = error_data["error"].get("message", "")
                    if "limit: 0" in message:
                        print()
                        print("⚠️  PROBLÈME IDENTIFIÉ:")
                        print("   Le quota est à ZÉRO (limit: 0)")
                        print("   Cela signifie que le projet Google Cloud")
                        print("   n'a pas de quota free tier activé.")
                        print()
                        print("   Solutions:")
                        print("   1. Activer la facturation sur le projet")
                        print("   2. Créer un nouveau projet Google Cloud")
                        print("   3. Utiliser une autre clé API")
            except:
                print(response.text)
            return False
            
        elif response.status_code == 401:
            # Clé invalide
            print("❌ ERREUR: Clé API invalide (401)")
            print()
            print("La clé API n'est pas valide ou n'a pas les permissions.")
            return False
            
        else:
            # Autre erreur
            print(f"❌ ERREUR: {response.status_code}")
            print()
            print("Réponse:")
            print(response.text)
            return False
            
    except requests.exceptions.Timeout:
        print("❌ ERREUR: Timeout (10 secondes)")
        print()
        print("L'API Google ne répond pas.")
        return False
        
    except requests.exceptions.RequestException as e:
        print(f"❌ ERREUR: {type(e).__name__}")
        print()
        print(str(e))
        return False
    
    except Exception as e:
        print(f"❌ ERREUR INATTENDUE: {type(e).__name__}")
        print()
        print(str(e))
        return False

if __name__ == "__main__":
    print()
    success = test_google_api()
    print()
    print("=" * 60)
    
    if success:
        print("✅ Test réussi - La clé fonctionne correctement")
        sys.exit(0)
    else:
        print("❌ Test échoué - La clé ne fonctionne pas")
        sys.exit(1)
