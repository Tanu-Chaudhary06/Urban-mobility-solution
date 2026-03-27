# Urban-mobility-solution
Topic: Urban Mobility Demand Forecasting System
An AI-driven spatio-temporal forecasting engine designed to predict ride demand across city zones. This project leverages Graph-based logic, Random Forest Regression, and Real-time Environmental APIs to optimize resource allocation in urban transport.

📌 Problem Statement
Urban mobility demand fluctuates drastically due to spatial (location-based) and temporal (time-based) factors. Traditional models often fail to account for weather conditions or the interconnected nature of city zones.

Our Solution: A predictive engine that integrates historical trip data with live weather context and zone-neighbor relationships to provide high-accuracy demand forecasts, helping operators reduce wait times and fuel waste.

🏗️ System Architecture
The project follows a decoupled Client-Server-Model architecture:

Frontend (The Visualization Suite)
Vanilla JS: Manages state, DOM manipulation, and asynchronous fetch requests.

Leaflet.js: Renders interactive maps and demand heatmaps.

Chart.js: Visualizes temporal trends and demand spikes via bar/line graphs.

Vis.js: Displays the underlying network graph of city zones and their connections.

Backend (The Orchestration Layer)
Flask (Python): REST API handles incoming requests and processes data.

Weather API (OpenWeather): Integrates real-time weather (temp/rain) with a 5-minute cache to optimize performance.

Pre-computed Lookup Tables: Fast retrieval of zone encodings, graph neighbors, and historical averages.

Machine Learning Engine
Model: Random Forest (RF) Regressor.

Hyperparameters: 150 Trees, Max Depth = 18.

Features: Temporal (Hour, Day, IsHoliday), Spatial (Zone ID, Neighbor demand), and Environmental (Rain, Temp).

Database
SQLite (predictions.db): Stores prediction logs including zone, hour, and predicted_demand for future auditing.
