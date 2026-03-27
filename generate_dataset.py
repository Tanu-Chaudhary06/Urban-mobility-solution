"""
Generate synthetic urban mobility demand dataset with realistic patterns.
Zones are modeled as a graph with adjacency relationships.
"""
import csv
import random
import os

ZONES = [
    "Sector 1", "Sector 2", "Sector 3", "Sector 4", "Sector 5",
    "Sector 6", "Sector 7", "Sector 8", "Sector 9", "Sector 10",
    "Supela", "Nehru Nagar", "Bhilai 3", "Durg Station", "Civic Center",
    "Junwani", "Smriti Nagar", "Power House", "Padmanabhpur", "Kohka"
]

# Adjacency list: zone -> list of neighboring zones
ADJACENCY = {
    "Sector 1":      ["Sector 2", "Sector 6", "Civic Center"],
    "Sector 2":      ["Sector 1", "Sector 3", "Sector 7"],
    "Sector 3":      ["Sector 2", "Sector 4", "Supela"],
    "Sector 4":      ["Sector 3", "Sector 5", "Nehru Nagar"],
    "Sector 5":      ["Sector 4", "Sector 10", "Bhilai 3"],
    "Sector 6":      ["Sector 1", "Sector 7", "Junwani"],
    "Sector 7":      ["Sector 6", "Sector 2", "Sector 8", "Smriti Nagar"],
    "Sector 8":      ["Sector 7", "Sector 9", "Power House"],
    "Sector 9":      ["Sector 8", "Sector 10", "Padmanabhpur"],
    "Sector 10":     ["Sector 9", "Sector 5", "Kohka"],
    "Supela":        ["Sector 3", "Nehru Nagar", "Durg Station"],
    "Nehru Nagar":   ["Sector 4", "Supela", "Bhilai 3"],
    "Bhilai 3":      ["Sector 5", "Nehru Nagar", "Kohka"],
    "Durg Station":  ["Supela", "Civic Center", "Padmanabhpur"],
    "Civic Center":  ["Sector 1", "Durg Station", "Junwani"],
    "Junwani":       ["Sector 6", "Civic Center", "Smriti Nagar"],
    "Smriti Nagar":  ["Sector 7", "Junwani", "Power House"],
    "Power House":   ["Sector 8", "Smriti Nagar", "Padmanabhpur"],
    "Padmanabhpur":  ["Sector 9", "Power House", "Durg Station"],
    "Kohka":         ["Sector 10", "Bhilai 3", "Padmanabhpur"]
}

# Base demand multipliers per zone (some zones are busier)
ZONE_BASE = {
    "Sector 1": 1.3, "Sector 2": 1.1, "Sector 3": 1.0, "Sector 4": 0.9,
    "Sector 5": 0.85, "Sector 6": 1.05, "Sector 7": 1.15, "Sector 8": 0.95,
    "Sector 9": 0.9, "Sector 10": 0.8, "Supela": 1.4, "Nehru Nagar": 1.25,
    "Bhilai 3": 1.1, "Durg Station": 1.5, "Civic Center": 1.45,
    "Junwani": 1.0, "Smriti Nagar": 1.05, "Power House": 0.95,
    "Padmanabhpur": 1.1, "Kohka": 0.85
}

# Weather conditions
WEATHER_CONDITIONS = ["Clear", "Cloudy", "Rain", "Heavy Rain", "Fog", "Thunderstorm"]
WEATHER_DEMAND_FACTOR = {
    "Clear": 1.0, "Cloudy": 1.05, "Rain": 1.3, "Heavy Rain": 1.5,
    "Fog": 0.85, "Thunderstorm": 1.6
}

def hour_demand_pattern(hour):
    """Realistic hourly demand pattern with morning/evening peaks."""
    patterns = {
        0: 0.15, 1: 0.10, 2: 0.08, 3: 0.06, 4: 0.08, 5: 0.20,
        6: 0.45, 7: 0.75, 8: 1.0,  9: 0.90, 10: 0.70, 11: 0.65,
        12: 0.75, 13: 0.70, 14: 0.60, 15: 0.65, 16: 0.80, 17: 1.05,
        18: 1.10, 19: 0.95, 20: 0.75, 21: 0.55, 22: 0.40, 23: 0.25
    }
    return patterns.get(hour, 0.5)

def generate_dataset(output_path="data/demand_data.csv", num_days=90):
    """Generate synthetic demand data for all zones over num_days."""
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    rows = []
    for day_idx in range(num_days):
        day_of_week = day_idx % 7
        day_type = "Weekend" if day_of_week >= 5 else "Weekday"
        day_factor = 0.85 if day_type == "Weekend" else 1.0

        # Pick weather for the day (with seasonal variation)
        if day_idx < 30:
            weather_weights = [0.3, 0.3, 0.2, 0.05, 0.1, 0.05]
        elif day_idx < 60:
            weather_weights = [0.15, 0.2, 0.3, 0.15, 0.05, 0.15]
        else:
            weather_weights = [0.35, 0.3, 0.15, 0.05, 0.1, 0.05]

        daily_weather = random.choices(WEATHER_CONDITIONS, weights=weather_weights, k=1)[0]
        temperature = random.randint(20, 42) if daily_weather != "Fog" else random.randint(10, 22)
        humidity = random.randint(30, 95)

        for hour in range(24):
            # Slight weather variation per time block
            if random.random() < 0.15:
                hour_weather = random.choice(WEATHER_CONDITIONS)
            else:
                hour_weather = daily_weather

            for zone in ZONES:
                base = 50 * ZONE_BASE[zone]
                time_factor = hour_demand_pattern(hour)
                weather_factor = WEATHER_DEMAND_FACTOR[hour_weather]

                # Weekend evening boost
                if day_type == "Weekend" and 17 <= hour <= 22:
                    day_factor_adj = 1.15
                else:
                    day_factor_adj = day_factor

                demand = base * time_factor * day_factor_adj * weather_factor
                demand += random.gauss(0, demand * 0.12)  # noise
                demand = max(0, round(demand, 1))

                rows.append({
                    "Zone": zone,
                    "Hour": hour,
                    "DayType": day_type,
                    "DayOfWeek": day_of_week,
                    "Weather": hour_weather,
                    "Temperature": temperature,
                    "Humidity": humidity,
                    "Demand": demand
                })

    random.shuffle(rows)

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "Zone", "Hour", "DayType", "DayOfWeek", "Weather",
            "Temperature", "Humidity", "Demand"
        ])
        writer.writeheader()
        writer.writerows(rows)

    print(f"Generated {len(rows)} records -> {output_path}")

if __name__ == "__main__":
    generate_dataset()
