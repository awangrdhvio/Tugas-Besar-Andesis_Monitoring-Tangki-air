import time
from flask import Response, stream_with_context
from flask import Flask, request, jsonify
from flask_cors import CORS          
import mysql.connector
from config import DB_CONFIG, TANK_CAPACITY_LITER

app = Flask(__name__)
CORS(app)           

last_streamed_id = None
 
def generate_stream():
    """Generator SSE: cek DB setiap 1 detik, kirim jika ada data baru"""
    global last_streamed_id
    while True:
        try:
            conn   = get_db()
            cursor = conn.cursor(dictionary=True)
            cursor.execute(
                "SELECT * FROM readings ORDER BY id DESC LIMIT 1"
            )
            row = cursor.fetchone()
            cursor.close()
            conn.close()
 
            if row and row['id'] != last_streamed_id:
                last_streamed_id = row['id']
                row['waktu'] = str(row['waktu'])
                import json
                data = json.dumps(row)
                # Format SSE: "event: nama\ndata: payload\n\n"
                yield f"event: water_data\ndata: {data}\n\n"
 
        except Exception as e:
            # Kirim event error agar browser tahu
            yield f"event: error\ndata: {str(e)}\n\n"
 
        time.sleep(1)  # Cek DB setiap 1 detik
 
@app.route("/api/stream")
def stream():
    return Response(
        stream_with_context(generate_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control":               "no-cache",
            "X-Accel-Buffering":           "no",
            "Access-Control-Allow-Origin": "*",
        }
    )

def get_status(persentase):
    if persentase > 70:
        return "Cukup"
    elif persentase >= 30:
        return "Sedang"
    else:
        return "Kritis"

def get_db():
    return mysql.connector.connect(**DB_CONFIG)

@app.route("/api/water", methods=["POST"])
def receive_data():
    data = request.get_json()
    if not data or "water_level" not in data:
        return jsonify({"error": "Data tidak valid"}), 400

    persentase   = int(data["water_level"])
    persentase   = max(0, min(100, persentase))   # clamp 0-100
    volume_liter = round((persentase / 100.0) * TANK_CAPACITY_LITER, 3)
    status       = get_status(persentase)

    try:
        conn   = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO readings (persentase, volume_liter, status) VALUES (%s, %s, %s)",
            (persentase, volume_liter, status)
        )
        conn.commit()
        cursor.close()
        conn.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return jsonify({
        "message":      "Data tersimpan",
        "persentase":   persentase,
        "volume_liter": volume_liter,
        "status":       status
    }), 200

@app.route("/api/latest", methods=["GET"])
def get_latest():
    conn   = get_db()
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT * FROM readings ORDER BY waktu DESC LIMIT 1")
    row = cursor.fetchone()
    cursor.close()
    conn.close()
    if row:
        row["waktu"] = str(row["waktu"])
    return jsonify(row)

@app.route("/api/history", methods=["GET"])
def get_history():
    conn   = get_db()
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT * FROM readings ORDER BY waktu DESC LIMIT 50")
    rows = cursor.fetchall()
    for r in rows:
        r["waktu"] = str(r["waktu"])
    cursor.close()
    conn.close()
    return jsonify(rows)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)