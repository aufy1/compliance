from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import json
import os

app = FastAPI(title="Cable BOMcheck API")

# Konfiguracja CORS (pozwala na komunikację React -> FastAPI)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"], # Domyślny port Vite
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_FILE = "data/materials.json"

class SurveyResponse(BaseModel):
    product_name: str
    cable_type: str
    selected_materials: list[str]
    compliance_notes: str

def load_materials():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"materials": []}

@app.get("/api/materials")
def get_materials():
    return load_materials()

@app.post("/api/survey")
def submit_survey(response: SurveyResponse):
    # W wersji prod tutaj zapisywalibyśmy wynik do bazy (np. innego pliku JSON lub bazy SQL)
    print("Otrzymano ankietę:", response.dict())
    return {"status": "success", "message": "Ankieta BOMcheck została zapisana pomyślnie."}