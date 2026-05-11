#! /usr/bin/env python3

import json
import os
import threading
import time

from flask import Flask, render_template

from src.api import api_bp, init_api
from src.data_loader import ChartConfigLoader, DataLoader, HighlightingLoader


def _watch_csv_files(loaders, registry, base_dir):
    """Background daemon thread: poll CSV mtimes every 2s, auto-reload on change."""
    def _resolve(p):
        return p if os.path.isabs(p) else os.path.join(base_dir, p)

    # Build path tracking: {csv_path: {"mtime": float, "ids": [dataset_id, ...]}}
    path_map = {}
    for ds in registry["datasets"]:
        csv_path = _resolve(ds["csv"])
        try:
            mtime = os.path.getmtime(csv_path)
        except OSError:
            mtime = 0
        if csv_path not in path_map:
            path_map[csv_path] = {"mtime": mtime, "ids": []}
        path_map[csv_path]["ids"].append(ds["id"])

    while True:
        time.sleep(2)
        for csv_path, info in path_map.items():
            try:
                new_mtime = os.path.getmtime(csv_path)
            except OSError:
                continue
            if new_mtime > info["mtime"]:
                info["mtime"] = new_mtime
                for ds_id in info["ids"]:
                    if ds_id in loaders:
                        loaders[ds_id][0].reload()
                print(f"[Watcher] Reloaded {len(info['ids'])} dataset(s) from {os.path.basename(csv_path)}")


def create_app() -> Flask:
    app = Flask(__name__, template_folder="templates", static_folder="static")

    base_dir = os.path.dirname(__file__)
    config_dir = os.path.join(base_dir, "config")

    # Load dataset registry
    with open(os.path.join(config_dir, "datasets.json")) as f:
        registry = json.load(f)

    # Initialize all datasets from registry
    def _resolve(p):
        return p if os.path.isabs(p) else os.path.join(base_dir, p)

    loaders = {}
    for ds in registry["datasets"]:
        csv_path = _resolve(ds["csv"])
        charts_path = _resolve(ds["charts"])
        hl_path = _resolve(ds.get("highlighting", "config/incidents_highlighting.json"))
        loaders[ds["id"]] = (
            DataLoader(csv_path),
            ChartConfigLoader(charts_path),
            HighlightingLoader(hl_path),
        )

    # Pre-load all chart configs and highlighting configs
    for _, chart_cfg, hl_cfg in loaders.values():
        chart_cfg.load()
        hl_cfg.load()

    # Inject into API blueprint
    init_api(loaders, registry)

    # Register blueprints
    app.register_blueprint(api_bp)

    # Start background CSV file watcher
    watcher = threading.Thread(
        target=_watch_csv_files,
        args=(loaders, registry, base_dir),
        daemon=True,
    )
    watcher.start()

    @app.route("/")
    def index():
        return render_template("index.html")

    @app.route("/embed/<card_id>")
    def embed_card(card_id):
        return render_template("embed.html", card_id=card_id)

    return app


if __name__ == "__main__":
    app = create_app()
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
