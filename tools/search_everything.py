import subprocess
import json
import argparse
import sys

def search_everything(query, max_results=10):
    es_path = "es.exe" 
    try:
        subprocess.run([es_path, "-help"], capture_output=True, text=True, check=False)
    except FileNotFoundError:
        print(json.dumps({
            "success": False,
            "error": "Khong tim thay 'es.exe'. Vui long tai Everything CLI (es.exe) tu voidtools.com va them vao PATH."
        }))
        sys.exit(1)
    except Exception:
        pass

    try:
        result = subprocess.run([es_path, query, "-n", str(max_results)], capture_output=True, text=True, check=False)
        files = result.stdout.strip().split('\n')
        files = [f for f in files if f.strip()]
        
        print(json.dumps({
            "success": True,
            "query": query,
            "results": files
        }))
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }))
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("query")
    parser.add_argument("--max", type=int, default=10)
    args = parser.parse_args()
    
    search_everything(args.query, args.max)
