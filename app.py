#! /usr/bin/env python3

import json
import os

from flask import Flask, render_template

from src.api import api_bp, init_api
from src.data_loader import ChartConfigLoader, DataLoader


def create_app() -> Flask:
    app = Flask(__name__, template_folder="templates", static_folder="static")

    base_dir = os.path.dirname(__file__)
    config_dir = os.path.join(base_dir, "config")

    # Load dataset registry
    with open(os.path.join(config_dir, "datasets.json")) as f:
        registry = json.load(f)

    # Initialize all datasets from registry
    loaders = {}
    for ds in registry["datasets"]:
        csv_path = os.path.join(base_dir, ds["csv"])
        charts_path = os.path.join(base_dir, ds["charts"])
        loaders[ds["id"]] = (
            DataLoader(csv_path),
            ChartConfigLoader(charts_path),
        )

    # Pre-load all chart configs
    for _, chart_cfg in loaders.values():
        chart_cfg.load()

    # Inject into API blueprint
    init_api(loaders, registry)

    # Register blueprints
    app.register_blueprint(api_bp)

    @app.route("/")
    def index():
        return render_template("index.html")

    return app


if __name__ == "__main__":
    app = create_app()
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
