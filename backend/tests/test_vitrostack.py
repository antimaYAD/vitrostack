import os
import tempfile

os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(tempfile.mkdtemp(), "t.db")
os.environ["VITRO_STORAGE"] = tempfile.mkdtemp()
os.environ.pop("GEMINI_API_KEY", None)

from fastapi.testclient import TestClient  # noqa: E402

from app.engines import cutting, glass, wind  # noqa: E402
from app.engines.schedule_parser import parse_file  # noqa: E402
from app.main import app  # noqa: E402
from contextlib import contextmanager  # noqa: E402


@contextmanager
def client(email="admin@vitrostack.local", password="admin123"):
    with TestClient(app) as c:
        r = c.post("/api/v1/auth/login", json={"email": email, "password": password})
        assert r.status_code == 200, r.text
        yield c


def test_wind_pressure_increases_with_height():
    low = wind.design_pressure("Mumbai", 10)["design_pressure_kpa"]
    high = wind.design_pressure("Mumbai", 100)["design_pressure_kpa"]
    assert 0.5 < low < high < 4


def test_unsafe_glass_gets_recommendation():
    r = wind.calculate_is875_wind_load("Mumbai", 42.9, 2400, 1500, "6mm_toughened")
    assert not r["safe"] and r["recommended_glass_spec"]
    ok = wind.calculate_is875_wind_load("Mumbai", 42.9, 2400, 1500, r["recommended_glass_spec"])
    assert ok["safe"]


def test_laminated_parse():
    s = glass.parse_glass_spec("13.52mm_laminated")
    assert s.plies_mm == [6, 6] and s.kind == "laminated"
    assert glass.parse_glass_spec("6+6 PVB laminated toughened").treatment == "toughened"


def test_cutting_no_overlap_and_within_sheet():
    res = cutting.optimize([{"tag": "A", "width_mm": 1200, "height_mm": 900, "quantity": 17},
                            {"tag": "B", "width_mm": 2000, "height_mm": 1100, "quantity": 5}])
    for g in res["groups"]:
        for s in g["sheets"]:
            ps = s["placements"]
            for p in ps:
                assert p["x"] + p["w"] <= s["width_mm"] and p["y"] + p["h"] <= s["height_mm"]
            for i, a in enumerate(ps):
                for b in ps[i + 1:]:
                    assert a["x"] + a["w"] <= b["x"] or b["x"] + b["w"] <= a["x"] or \
                        a["y"] + a["h"] <= b["y"] or b["y"] + b["h"] <= a["y"]
    assert res["totals"]["panel_count"] == 22


def test_offcuts_used_first():
    res = cutting.optimize([{"tag": "A", "width_mm": 1000, "height_mm": 800, "quantity": 1, "glass_spec": "s"}],
                           [{"id": 7, "width_mm": 1100, "height_mm": 900, "glass_spec": "s"}])
    assert res["totals"]["jumbo_sheets"] == 0 and res["totals"]["offcuts_used"] == 1


def test_schedule_parser_units():
    csv = b"Project X schedule\nTag,Width (m),Height (m),Qty,Floor\nW1,2.4,1.5,10,12\nW2,1.8,,4,12\n"
    r = parse_file("s.csv", csv)
    assert r["rows"][0]["width_mm"] == 2400 and r["rows"][0]["quantity"] == 10
    assert r["rows"][1]["needs_review"]


def test_agent_full_flow_and_approval():
    with client() as c:
        r = c.post("/api/v1/agent/chat", json={"message": "Quote 45 butt-joint windows of 2400x1500mm for a 12th-floor project in Mumbai"})
        assert r.status_code == 200, r.text
        m = r.json()["message"]
        tools = [s["tool"] for s in m["steps"]]
        assert tools.index("calculate_is875_wind_load") < tools.index("optimize_2d_glass_cutting")
        assert m["pending_action"]["tool"] == "generate_client_quote_pdf"
        sid, aid = r.json()["session_id"], m["pending_action"]["id"]
        r2 = c.post(f"/api/v1/agent/sessions/{sid}/actions/{aid}", json={"approve": True, "overrides": {"margin_percent": 20}})
        assert r2.status_code == 200, r2.text
        pid = r2.json()["project_id"]
        pdf = c.get(f"/api/v1/projects/{pid}/quote.pdf")
        assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"


def test_agent_asks_for_missing_inputs():
    with client() as c:
        m = c.post("/api/v1/agent/chat", json={"message": "quote 20 windows 1800x1200"}).json()["message"]
        assert "city" in m["content"] and not m.get("pending_action")


def test_whatsapp_breakage_creates_alert():
    with client() as c:
        r = c.post("/api/v1/whatsapp/simulate", json={"phone": "+919800000001", "text": "BROKEN W1-03"}).json()
        assert r["action"] == "breakage"
        assert c.post(f"/api/v1/alerts/{r['alert_id']}/approve").status_code == 200


def test_admin_prices_drive_quotes():
    with client() as c:
        base = c.get("/api/v1/admin/prices").json()
        assert base["prices"]["glass"]["8mm_toughened"] > 0
        m = c.post("/api/v1/agent/chat", json={"message": "Quote 10 windows 1200x900mm, 5th floor, Pune with 8mm toughened"}).json()["message"]
        pid = m["project_id"]
        before = c.get(f"/api/v1/projects/{pid}/quote-preview?margin_percent=18").json()["quote"]
        prices = base["prices"]
        prices["glass"]["8mm_toughened"] = base["prices"]["glass"]["8mm_toughened"] * 2
        prices["commercial"]["gst_pct"] = 12
        r = c.put("/api/v1/admin/prices", json={"prices": prices})
        assert r.status_code == 200, r.text
        after = c.get(f"/api/v1/projects/{pid}/quote-preview?margin_percent=18").json()["quote"]
        assert after["direct_cost"] > before["direct_cost"] and after["gst_percent"] == 12
        assert c.get("/api/v1/admin/prices/history").json()[0]["changed_by"] == "Admin"
        bad = {"glass": {"8mm_toughened": -5}}
        assert c.put("/api/v1/admin/prices", json={"prices": bad}).status_code == 400


def test_auth_required_and_roles():
    with TestClient(app) as anon:
        assert anon.get("/api/v1/projects").status_code == 401
        assert anon.get("/api/v1/health").status_code == 200
        assert anon.post("/api/v1/auth/login", json={"email": "admin@vitrostack.local", "password": "nope"}).status_code == 401
    with client("estimator@vitrostack.local", "estimator123") as est:
        assert est.get("/api/v1/projects").status_code == 200
        assert est.get("/api/v1/admin/prices").status_code == 403
        assert est.get("/api/v1/admin/users").status_code == 403
        assert est.get("/api/v1/auth/me").json()["user"]["role"] == "estimator"
        est.post("/api/v1/auth/logout")
        assert est.get("/api/v1/projects").status_code == 401


def test_admin_user_management():
    with client() as c:
        r = c.post("/api/v1/admin/users", json={"name": "Site Lead", "email": "lead@example.com", "role": "estimator"})
        assert r.status_code == 201, r.text
        temp, uid = r.json()["temporary_password"], r.json()["user"]["id"]
        me = c.get("/api/v1/auth/me").json()["user"]
        assert c.patch(f"/api/v1/admin/users/{me['id']}", json={"role": "estimator"}).status_code == 400
        assert c.patch(f"/api/v1/admin/users/{uid}", json={"active": False}).status_code == 200
    with TestClient(app) as c2:
        assert c2.post("/api/v1/auth/login", json={"email": "lead@example.com", "password": temp}).status_code == 401


def test_register_creates_isolated_workspace():
    with TestClient(app) as c:
        r = c.post("/api/v1/auth/register", json={"company": "Glassworks", "name": "Asha", "email": "asha@glassworks.in", "password": "secret123"})
        assert r.status_code == 201, r.text
        assert r.json()["user"]["role"] == "admin"
        assert c.get("/api/v1/projects").json() == []  # new tenant sees none of the demo org's data
        assert c.get("/api/v1/admin/users").status_code == 200
        dup = c.post("/api/v1/auth/register", json={"company": "Other Co", "name": "Y", "email": "asha@glassworks.in", "password": "secret123"})
        assert dup.status_code == 400
