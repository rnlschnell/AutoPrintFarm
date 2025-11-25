import requests

files = {'file': open(r'C:\Users\nlsch\AutoPrintFarm\files\print_files\6b8e180f-04c7-4e91-82d7-16bcd0267d0d.3mf', 'rb')}
response = requests.post('http://127.0.0.1:8787/api/v1/files/parse-metadata', files=files)
print(f"Status: {response.status_code}")
print(f"Response: {response.text}")
