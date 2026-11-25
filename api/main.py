from datetime import datetime
from typing import List, Optional
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="LankaStay Monsoon Hotel Ranking API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class HotelInput(BaseModel):
    id: int | str
    name: str
    region: str
    price: float
    score: Optional[int] = 80
    img: Optional[str] = None
    plainEnglish: Optional[str] = None
    description: Optional[str] = None
    rating: Optional[float] = 4.7


class RankHotelsRequest(BaseModel):
    month: Optional[int] = None  # 1 - 12 (defaults to current month)
    hotels: List[HotelInput]


def normalize_zone(region: str, name: str = "") -> str:
    combined = f"{region or ''} {name or ''}".lower()

    if any(k in combined for k in ["south coast", "south", "west", "galle", "bentota", "mirissa", "unawatuna", "weligama", "colombo", "negombo"]):
        return "south_west"
    if any(k in combined for k in ["east coast", "east", "pasikuda", "pasikudah", "trincomalee", "batticaloa", "arugam", "jaffna", "north"]):
        return "east_north"
    if any(k in combined for k in ["hill country", "hill", "hatton", "kandy", "ella", "nuwara eliya", "haputale"]):
        return "hill_country"
    return "cultural"


def evaluate_monsoon(zone: str, month: int) -> dict:
    # Southwest Monsoon: May (5) to September (9)
    if month in [5, 6, 7, 8, 9]:
        if zone == "south_west":
            return {
                "monsoon_active": True,
                "season_label": "Southwest Monsoon Active",
                "summary": "Heavy South-West monsoon rains expected — down-ranked for this month.",
                "base_fit": 54,
                "penalty": 18,
            }
        if zone == "hill_country":
            return {
                "monsoon_active": True,
                "season_label": "Southwest Monsoon Showers",
                "summary": "Misty & wet hill spells possible during Southwest monsoon — score adjusted.",
                "base_fit": 66,
                "penalty": 10,
            }
        if zone == "east_north":
            return {
                "monsoon_active": False,
                "season_label": "Dry & Sunny Season",
                "summary": "No monsoon — East/North enjoys dry, calm conditions and top ranking.",
                "base_fit": 97,
                "penalty": 0,
            }
        return {
            "monsoon_active": False,
            "season_label": "Favorable Dry Window",
            "summary": "No active monsoon — warm, dry weather with strong trip fit.",
            "base_fit": 93,
            "penalty": 0,
        }

    # Northeast Monsoon: November (11) to February (2)
    if month in [11, 12, 1, 2]:
        if zone == "east_north":
            return {
                "monsoon_active": True,
                "season_label": "Northeast Monsoon Active",
                "summary": "Northeast monsoon active on East/North coast — down-ranked for this month.",
                "base_fit": 55,
                "penalty": 18,
            }
        if zone == "south_west":
            return {
                "monsoon_active": False,
                "season_label": "Peak Dry Season",
                "summary": "No monsoon — South/West coast is dry, sunny, and ranked at the top.",
                "base_fit": 98,
                "penalty": 0,
            }
        if zone == "hill_country":
            return {
                "monsoon_active": False,
                "season_label": "Crisp & Clear Hills",
                "summary": "No monsoon — cool, clear mountain weather ideal for travel.",
                "base_fit": 95,
                "penalty": 0,
            }
        return {
            "monsoon_active": False,
            "season_label": "Optimal Dry Season",
            "summary": "No monsoon — dry skies and comfortable sightseeing weather.",
            "base_fit": 96,
            "penalty": 0,
        }

    # Inter-monsoon / Transition months: March (3), April (4), October (10)
    if month == 3:
        return {
            "monsoon_active": False,
            "season_label": "Warm Dry Transition",
            "summary": "No active monsoon — warm, mostly dry weather across key regions.",
            "base_fit": 91,
            "penalty": 0,
        }

    return {
        "monsoon_active": False,
        "season_label": "Inter-Monsoon (Brief Showers)",
        "summary": "No major monsoon — passing afternoon showers possible.",
        "base_fit": 78,
        "penalty": 0,
    }


@app.post("/api/hotels/rank")
def rank_hotels(payload: RankHotelsRequest):
    target_month = payload.month if (payload.month and 1 <= payload.month <= 12) else datetime.now().month

    ranked_list = []
    for hotel in payload.hotels:
        zone = normalize_zone(hotel.region, hotel.name)
        info = evaluate_monsoon(zone, target_month)

        rating_val = hotel.rating if hotel.rating else 4.7
        rating_component = min(100.0, (rating_val / 5.0) * 100.0)

        # Blend weather/monsoon fit (75%) + hotel rating (25%)
        raw_score = (info["base_fit"] * 0.75) + (rating_component * 0.25)
        final_score = int(round(max(25, min(99, raw_score - info["penalty"]))))

        ranked_list.append({
            **hotel.model_dump(),
            "zone": zone,
            "score": final_score,
            "trip_fit_score": final_score,
            "monsoon_active": info["monsoon_active"],
            "season_label": info["season_label"],
            "plainEnglish": info["summary"],
        })

    # Top level: No-monsoon hotels (monsoon_active == False) first, then highest Trip Fit Score
    ranked_list.sort(
        key=lambda h: (not h["monsoon_active"], h["score"]),
        reverse=True,
    )

    active_monsoon_banner = (
        "Southwest Monsoon Active (May–Sep): South/West & Hill areas are down-ranked while dry regions lead."
        if target_month in [5, 6, 7, 8, 9]
        else "Northeast Monsoon Active (Nov–Feb): East/North coast hotels are down-ranked while dry regions lead."
        if target_month in [11, 12, 1, 2]
        else "No Active Monsoon: Dry and shoulder-season regions are ranked by weather & trip fit."
    )

    return {
        "month": target_month,
        "monsoon_banner": active_monsoon_banner,
        "hotels": ranked_list,
    }