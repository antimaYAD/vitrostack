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


def test_window_designs_crud_and_scoping():
    design = {"name": "W01", "width_mm": 1800, "height_mm": 2100, "shape": "rect",
              "root": {"id": "a", "kind": "leaf", "open": "fixed", "fill": "glass"}}
    with client() as c:
        pid = c.post("/api/v1/projects", json={"name": "Designer test", "city": "Pune", "building_height_m": 20,
                                               "panels": [{"width_mm": 1000, "height_mm": 1000}]}).json()["id"]
        assert c.post("/api/v1/designs", json={"name": "Bad", "data": {"no": "root"}}).status_code == 400
        assert c.post("/api/v1/designs", json={"name": "Bad", "data": design, "project_id": "nope"}).status_code == 400
        r = c.post("/api/v1/designs", json={"name": "W01", "data": design, "project_id": pid, "summary": {"panes": 1}})
        assert r.status_code == 201, r.text
        did = r.json()["id"]
        assert r.json()["created_by"] == "Admin"
        listed = c.get(f"/api/v1/designs?project_id={pid}").json()
        assert [d["id"] for d in listed] == [did] and listed[0]["project_name"] == "Designer test"
        design["width_mm"] = 2400
        r = c.put(f"/api/v1/designs/{did}", json={"name": "W01 rev B", "data": design, "project_id": pid})
        assert r.json()["name"] == "W01 rev B" and r.json()["data"]["width_mm"] == 2400
        # Deleting the project keeps the design but unlinks it.
        assert c.delete(f"/api/v1/projects/{pid}").status_code == 204
        assert c.get(f"/api/v1/designs/{did}").json()["project_id"] is None
    with client("estimator@vitrostack.local", "estimator123") as c:
        assert c.get(f"/api/v1/designs/{did}").status_code == 200  # same organisation
        assert c.delete(f"/api/v1/designs/{did}").status_code == 204
        assert c.get(f"/api/v1/designs/{did}").status_code == 404


def test_only_admin_adds_offcuts():
    piece = {"glass_spec": "12mm_toughened", "width_mm": 900, "height_mm": 600}
    with client("estimator@vitrostack.local", "estimator123") as est:
        assert est.get("/api/v1/offcuts").status_code == 200
        assert est.post("/api/v1/offcuts", json=piece).status_code == 403
        pid = est.get("/api/v1/projects").json()[0]["id"]
        assert est.post(f"/api/v1/projects/{pid}/remnants").status_code == 403
    with client() as c:
        r = c.post("/api/v1/offcuts", json=piece)
        assert r.status_code == 201
        assert c.delete(f"/api/v1/offcuts/{r.json()[0]['id']}").status_code == 204


def _facade(joint, glass="12mm_toughened", op3="fixed"):
    return {"elevation_id": "W-101", "overall_width_mm": 4800, "overall_height_mm": 3000, "wind_pressure_kpa": 1.85,
            "bays": [{"bay_index": i, "x_mm": (i - 1) * 1600, "width_mm": 1600, "height_mm": 3000,
                      "operation": op3 if i == 3 else "fixed", "glass_spec": glass,
                      "track_system": "2_track_recessed" if op3 != "fixed" and i == 3 else None,
                      "right_joint": joint if i < 3 else None} for i in (1, 2, 3)]}


def test_facade_canvas_wind_bom_and_dxf():
    import io
    import math
    import ezdxf

    butt = {"type": "silicone_butt_joint", "gap_mm": 8, "sealant": "Dow_Dowsil_995"}
    with client("estimator@vitrostack.local", "estimator123") as c:
        # Unbacked butt joints leave the vertical edges free: 3 m panes spanning one way fail.
        free = c.post("/api/v1/canvas/validate-wind-load", json=_facade(butt)).json()
        assert not free["pass"] and all(p["support"].startswith("two-edge") for p in free["panes"])
        assert "glass fin" in free["panes"][0]["hint"]
        # A glass fin supports the edges, and 12 mm toughened passes at 1.85 kPa.
        fin = c.post("/api/v1/canvas/validate-wind-load", json=_facade({**butt, "backing": "glass_fin"})).json()
        assert fin["pass"] and all(p["support"] == "four-edge" for p in fin["panes"])
        j = fin["joints"][0]
        assert j["required_bite_mm"] == max(6, math.ceil(1.85 * j["short_span_mm"] / (2 * 138)))
        # Net glass: 1600 module − 50 frame − 4 (half gap) + 12 rebate into the frame; no rebate at the butt joint.
        assert (fin["panes"][0]["glass_width_mm"], fin["panes"][0]["glass_height_mm"]) == (1558, 2924)

        # Site wind pressure is computed with IS 875 when a site is given.
        site = c.post("/api/v1/canvas/validate-wind-load", json={**_facade(butt), "site": {"city": "Mumbai", "height_m": 45}}).json()
        assert site["wind"]["city"] == "Mumbai" and site["wind_pressure_kpa"] == site["wind"]["design_pressure_kpa"]

        # BOM: 2 butt joints × 2.9 m, silicone = 8 × 12 × 2900 mm³ each, polished edges on both sides of each joint.
        bom = c.post("/api/v1/canvas/extract-bom", json=_facade({**butt, "backing": "glass_fin"})).json()
        assert bom["silicone"]["butt_joint_m"] == 5.8 and bom["silicone"]["net_ml"] == round(2 * 8 * 12 * 2900 / 1000)
        assert bom["polished_edge_m"] == round(4 * 2924 / 1000, 2) and bom["aluminium"]["mullion_m"] == 0
        # Sliding bay with mullions: track head + sill, and a slider beside a butt joint is an error.
        slide = c.post("/api/v1/canvas/extract-bom", json=_facade({"type": "aluminum_mullion"}, op3="sliding_left")).json()
        assert slide["aluminium"]["tracks"][0]["length_m"] == round(2 * (1600 - 25 - 50) / 1000, 2)
        bad = c.post("/api/v1/canvas/validate-wind-load", json=_facade(butt, op3="sliding_left")).json()
        assert any(i["level"] == "error" and "sliding" in i["message"] for i in bad["issues"])
        # DGU is cut as two 6 mm lites.
        dgu = c.post("/api/v1/canvas/extract-bom", json=_facade({"type": "aluminum_mullion"}, glass="24mm_dgu")).json()
        assert {x["glass_spec"] for x in dgu["cutting_list"]} == {"6mm_toughened"} and sum(x["quantity"] for x in dgu["cutting_list"]) == 6

        # Geometry that doesn't add up is rejected.
        wrong = _facade(butt)
        wrong["bays"][0]["width_mm"] = 1500
        r = c.post("/api/v1/canvas/validate-wind-load", json=wrong)
        assert r.status_code == 400 and "4700" in r.json()["detail"]

        # DXF is a readable drawing in millimetres with the expected layers.
        r = c.post("/api/v1/canvas/export-dxf", json=_facade(butt))
        assert r.status_code == 200 and r.headers["content-disposition"].endswith('"W-101.dxf"')
        doc = ezdxf.read(io.StringIO(r.content.decode()))
        assert doc.header["$INSUNITS"] == 4
        layers = {e.dxf.layer for e in doc.modelspace()}
        assert {"VS-FRAME", "VS-GLASS", "VS-BUTT-JOINT", "VS-DIMENSIONS"} <= layers

        # Facade elevations save to the shared library but stay out of the window designer's list.
        saved = c.post("/api/v1/designs", json={"name": "Lobby", "data": {"kind": "facade", "bays": [{}]}})
        assert saved.status_code == 201
        assert all(d["id"] != saved.json()["id"] for d in c.get("/api/v1/designs").json())
        assert any(d["id"] == saved.json()["id"] for d in c.get("/api/v1/designs?kind=facade").json())
        assert c.post("/api/v1/designs", json={"name": "x", "data": {"kind": "facade", "bays": []}}).status_code == 400
        c.delete(f"/api/v1/designs/{saved.json()['id']}")


def test_facade_infills_and_doors():
    mull = {"type": "aluminum_mullion"}
    data = _facade(mull)
    data["bays"][0] = {**data["bays"][0], "operation": None, "glass_spec": None, "panes": [
        {"pane_index": 1, "height_mm": 600, "infill": "louvre"},
        {"pane_index": 2, "height_mm": 2400, "operation": "door"}]}
    data["bays"][1] = {**data["bays"][1], "operation": "tilt_turn", "infill": "glass"}
    data["bays"][2] = {**data["bays"][2], "infill": "spandrel"}
    with client("estimator@vitrostack.local", "estimator123") as c:
        v = c.post("/api/v1/canvas/validate-wind-load", json=data).json()
        assert not [i for i in v["issues"] if i["level"] == "error"], v["issues"]
        by = {p["mark"]: p for p in v["panes"]}
        assert by["W-101/B1-A"]["infill"] == "louvre" and by["W-101/B1-A"]["utilisation"] == 0
        assert by["W-101/B1-B"]["support"] == "four-edge"
        b = c.post("/api/v1/canvas/extract-bom", json=data).json()
        assert sorted(x["infill"] for x in b["infill_panels"]) == ["louvre", "spandrel"]
        assert {g["mark"] for g in b["glass"]} == {"W-101/B1-B", "W-101/B2-A"}
        assert b["aluminium"]["sash_m"] > 0
        # A door above a transom, an opening louvre and a spandrel at a butt joint are errors.
        bad = _facade({"type": "silicone_butt_joint", "gap_mm": 8, "backing": "glass_fin"})
        bad["bays"][0] = {**bad["bays"][0], "operation": None, "panes": [
            {"pane_index": 1, "height_mm": 2400, "operation": "door"}, {"pane_index": 2, "height_mm": 600}]}
        bad["bays"][1] = {**bad["bays"][1], "infill": "spandrel"}
        bad["bays"][2] = {**bad["bays"][2], "operation": "casement", "infill": "louvre"}
        msgs = " ".join(i["message"] for i in c.post("/api/v1/canvas/validate-wind-load", json=bad).json()["issues"])
        assert "bottom pane" in msgs and "can't be silicone butt-jointed" in msgs and "can't open" in msgs
        assert c.post("/api/v1/canvas/export-dxf", json=data).status_code == 200
