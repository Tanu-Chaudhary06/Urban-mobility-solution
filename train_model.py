"""
Train a Random Forest Regressor on the demand dataset with graph-based
feature engineering (neighbor demand influence).
"""
import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.preprocessing import LabelEncoder
import joblib
import os
import json

# Zone adjacency graph
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

def compute_neighbor_demand(df):
    """
    Graph-based feature engineering:
    For each row, compute the average demand of neighboring zones
    at the same hour and day type.
    """
    grouped = df.groupby(["Hour", "DayType", "Zone"])["Demand"].mean().to_dict()

    neighbor_demands = []
    for _, row in df.iterrows():
        zone = row["Zone"]
        hour = row["Hour"]
        day_type = row["DayType"]
        neighbors = ADJACENCY.get(zone, [])
        if neighbors:
            avg = np.mean([
                grouped.get((hour, day_type, n), 0) for n in neighbors
            ])
        else:
            avg = 0
        neighbor_demands.append(round(avg, 2))

    df["NeighborDemand"] = neighbor_demands
    return df

def train():
    """Train the Random Forest model and save artifacts."""
    print("Loading dataset...")
    df = pd.read_csv("data/demand_data.csv")
    print(f"Dataset: {len(df)} rows, {len(df.columns)} columns")

    # Graph-based feature engineering
    print("Computing neighbor demand influence...")
    df = compute_neighbor_demand(df)

    # Encode categorical variables
    zone_encoder = LabelEncoder()
    day_encoder = LabelEncoder()
    weather_encoder = LabelEncoder()

    df["Zone_enc"] = zone_encoder.fit_transform(df["Zone"])
    df["DayType_enc"] = day_encoder.fit_transform(df["DayType"])
    df["Weather_enc"] = weather_encoder.fit_transform(df["Weather"])

    # Cyclical encoding for hour
    df["Hour_sin"] = np.sin(2 * np.pi * df["Hour"] / 24)
    df["Hour_cos"] = np.cos(2 * np.pi * df["Hour"] / 24)

    # Features
    feature_cols = [
        "Zone_enc", "Hour", "Hour_sin", "Hour_cos",
        "DayType_enc", "DayOfWeek", "Weather_enc",
        "Temperature", "Humidity", "NeighborDemand"
    ]
    X = df[feature_cols]
    y = df["Demand"]

    # Train/test split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )

    print("Training Random Forest Regressor...")
    model = RandomForestRegressor(
        n_estimators=150,
        max_depth=18,
        min_samples_split=5,
        min_samples_leaf=2,
        random_state=42,
        n_jobs=-1
    )
    model.fit(X_train, y_train)

    # Evaluate
    y_pred = model.predict(X_test)
    mae = mean_absolute_error(y_test, y_pred)
    r2 = r2_score(y_test, y_pred)
    print(f"MAE: {mae:.2f}")
    print(f"R² Score: {r2:.4f}")

    # Feature importances
    importances = dict(zip(feature_cols, model.feature_importances_))
    print("\nFeature Importances:")
    for feat, imp in sorted(importances.items(), key=lambda x: -x[1]):
        print(f"  {feat}: {imp:.4f}")

    # Save model and encoders
    os.makedirs("models", exist_ok=True)
    joblib.dump(model, "models/rf_model.pkl")
    joblib.dump(zone_encoder, "models/zone_encoder.pkl")
    joblib.dump(day_encoder, "models/day_encoder.pkl")
    joblib.dump(weather_encoder, "models/weather_encoder.pkl")

    # Save zone list and adjacency for the API
    meta = {
        "zones": list(zone_encoder.classes_),
        "day_types": list(day_encoder.classes_),
        "weather_types": list(weather_encoder.classes_),
        "adjacency": ADJACENCY,
        "feature_cols": feature_cols,
        "mae": round(mae, 2),
        "r2": round(r2, 4)
    }
    with open("models/meta.json", "w") as f:
        json.dump(meta, f, indent=2)

    # Precompute average demands per zone/hour/daytype for neighbor lookups
    avg_demands = df.groupby(["Zone", "Hour", "DayType"])["Demand"].mean()
    avg_demands.to_csv("models/avg_demands.csv")

    print("\nModel and encoders saved to models/")

if __name__ == "__main__":
    train()
