"""
assets/spatial_desk/tools/desk_cad_parser.py — Trình phân tích, tách cụm chi tiết lắp ráp (Exploded Assembly)
và chỉnh sửa kích thước mô hình CAD 3D (.STL / .OBJ / .SCAD) trực tiếp trên mặt bàn làm việc.

Tính năng cốt lõi:
 1. Đọc và giải mã file 3D định dạng STL (Binary & ASCII) hoặc OBJ từ ổ đĩa (Desktop hoặc đường dẫn tuỳ chọn).
 2. Đo đạc kích thước bao thực tế (Bounding Box: Dài x Rộng x Cao milimet).
 3. Tách cụm chi tiết (Exploded Assembly View): Phân tách thân hộp và nắp trượt (hoặc các cụm rời rạc),
    hỗ trợ dịch chuyển nổ (explode offset) theo trục Z/X để hiển thị các chi tiết rải rác trên bàn.
 4. Chỉnh sửa kích thước thủ công (Interactive Resizing / Parametric Push-Pull): Co giãn theo từng trục
    hoặc gán kích thước mới (length, width, height), tự động cập nhật lưới tam giác kín nước và ghi đè file .STL mới.
 5. Xuất khung dây 3D (wireframe mesh vertices + edges) được tối ưu hoá cho Canvas 60 FPS.
"""
from datetime import datetime, timezone
import json
import math
import os
import struct
import sys
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
_SPATIAL_DESK_DIR = os.path.abspath(os.path.join(_HERE, ".."))
_REPO_ROOT = os.path.abspath(os.path.join(_HERE, "..", "..", ".."))
_CORE_TOOLS_DIR = os.path.join(_REPO_ROOT, "tools")
if _CORE_TOOLS_DIR not in sys.path:
    sys.path.insert(0, _CORE_TOOLS_DIR)

import _common  # noqa: E402
from file_explorer import resolve_target_path  # noqa: E402

_common.ensure_utf8()


def _resolve_cad_path(raw_path):
    if not raw_path:
        return ""
    clean = str(raw_path).strip().replace("\\", "/")
    if clean.lower().startswith("desktop/"):
        return os.path.normpath(os.path.join(resolve_target_path("desktop"), clean[8:]))
    try:
        return resolve_target_path(raw_path)
    except Exception:
        return os.path.abspath(raw_path)


def _parse_stl_binary(data):
    """Giải mã file Binary STL chuẩn (80 bytes header + 4 bytes uint32 count + 50 bytes/triangle)."""
    if len(data) < 84:
        raise ValueError("File STL binary quá ngắn hoặc bị hỏng")
    triangle_count = struct.unpack("<I", data[80:84])[0]
    expected_len = 84 + triangle_count * 50
    if len(data) < expected_len:
        # File có thể bị cắt ngắn
        triangle_count = (len(data) - 84) // 50

    triangles = []
    offset = 84
    for _ in range(triangle_count):
        normal = struct.unpack("<3f", data[offset : offset + 12])
        v1 = struct.unpack("<3f", data[offset + 12 : offset + 24])
        v2 = struct.unpack("<3f", data[offset + 24 : offset + 36])
        v3 = struct.unpack("<3f", data[offset + 36 : offset + 48])
        triangles.append({"normal": normal, "v1": v1, "v2": v2, "v3": v3})
        offset += 50
    return triangles


def _parse_stl_ascii(text):
    """Giải mã file ASCII STL chuẩn (solid ... facet normal ... vertex ... endfacet ... endsolid)."""
    lines = text.splitlines()
    triangles = []
    current_triangle = None
    vertices = []
    current_normal = (0.0, 0.0, 1.0)

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue
        parts = line.split()
        tag = parts[0].lower() if parts else ""

        if tag == "facet" and len(parts) >= 5 and parts[1].lower() == "normal":
            try:
                current_normal = (float(parts[2]), float(parts[3]), float(parts[4]))
            except ValueError:
                current_normal = (0.0, 0.0, 1.0)
            vertices = []
        elif tag == "vertex" and len(parts) >= 4:
            try:
                vertices.append((float(parts[1]), float(parts[2]), float(parts[3])))
            except ValueError:
                pass
        elif tag == "endfacet":
            if len(vertices) == 3:
                triangles.append({
                    "normal": current_normal,
                    "v1": vertices[0],
                    "v2": vertices[1],
                    "v3": vertices[2],
                })
            vertices = []

    return triangles


def load_stl_file(file_path):
    """Nạp file STL tự động nhận diện nhị phân hoặc văn bản."""
    with open(file_path, "rb") as f:
        data = f.read()

    # Thử parse binary trước nếu độ dài >= 84
    is_ascii = False
    if data[:5].lower() == b"solid":
        try:
            text = data[:2048].decode("utf-8", errors="ignore")
            if "facet normal" in text:
                is_ascii = True
        except Exception:
            is_ascii = False

    if is_ascii:
        return _parse_stl_ascii(data.decode("utf-8", errors="replace")), "stl_ascii"
    return _parse_stl_binary(data), "stl_binary"


def _parse_obj_ascii(text):
    """Phân tích tệp định dạng Wavefront .OBJ thành danh sách tam giác 3D."""
    raw_vertices = []
    triangles = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        tag = parts[0].lower()
        if tag == "v" and len(parts) >= 4:
            try:
                raw_vertices.append((float(parts[1]), float(parts[2]), float(parts[3])))
            except ValueError:
                pass
        elif tag == "f" and len(parts) >= 4:
            face_indices = []
            for p in parts[1:]:
                v_idx_str = p.split("/")[0]
                try:
                    v_idx = int(v_idx_str)
                    if v_idx > 0:
                        face_indices.append(v_idx - 1)
                    elif v_idx < 0:
                        face_indices.append(len(raw_vertices) + v_idx)
                except ValueError:
                    pass
            for i in range(1, len(face_indices) - 1):
                i0, i1, i2 = face_indices[0], face_indices[i], face_indices[i + 1]
                if 0 <= i0 < len(raw_vertices) and 0 <= i1 < len(raw_vertices) and 0 <= i2 < len(raw_vertices):
                    triangles.append({
                        "normal": (0.0, 0.0, 1.0),
                        "v1": raw_vertices[i0],
                        "v2": raw_vertices[i1],
                        "v3": raw_vertices[i2],
                    })
    return triangles


def load_cad_file(file_path):
    """Nạp file CAD 3D (.STL hoặc .OBJ) tự động nhận diện định dạng."""
    if file_path.lower().endswith(".obj"):
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            return _parse_obj_ascii(f.read()), "wavefront_obj"
    return load_stl_file(file_path)


def write_stl_binary(file_path, triangles, header_text="Iris Spatial CAD Editor"):
    """Ghi danh sách tam giác ra file Binary STL chuẩn tương thích 100% với các phần mềm Slicer."""
    header = header_text.encode("utf-8")[:80].ljust(80, b"\0")
    count = len(triangles)
    os.makedirs(os.path.dirname(os.path.abspath(file_path)), exist_ok=True)
    with open(file_path, "wb") as f:
        f.write(header)
        f.write(struct.pack("<I", count))
        for tri in triangles:
            norm = tri.get("normal", (0.0, 0.0, 1.0))
            v1, v2, v3 = tri["v1"], tri["v2"], tri["v3"]
            f.write(struct.pack("<3f", float(norm[0]), float(norm[1]), float(norm[2])))
            f.write(struct.pack("<3f", float(v1[0]), float(v1[1]), float(v1[2])))
            f.write(struct.pack("<3f", float(v2[0]), float(v2[1]), float(v2[2])))
            f.write(struct.pack("<3f", float(v3[0]), float(v3[1]), float(v3[2])))
            f.write(struct.pack("<H", 0))  # 2 bytes attribute byte count


def compute_bounding_box(triangles):
    """Tính hộp bao AABB của mô hình (min_x, max_x, min_y, max_y, min_z, max_z)."""
    if not triangles:
        return {"min": (0, 0, 0), "max": (0, 0, 0), "length": 0, "width": 0, "height": 0, "center": (0, 0, 0)}

    min_x = min_y = min_z = float("inf")
    max_x = max_y = max_z = float("-inf")

    for tri in triangles:
        for v in (tri["v1"], tri["v2"], tri["v3"]):
            min_x = min(min_x, v[0])
            max_x = max(max_x, v[0])
            min_y = min(min_y, v[1])
            max_y = max(max_y, v[1])
            min_z = min(min_z, v[2])
            max_z = max(max_z, v[2])

    length = round(max(0.1, max_x - min_x), 2)
    width = round(max(0.1, max_y - min_y), 2)
    height = round(max(0.1, max_z - min_z), 2)
    center = (
        round((min_x + max_x) / 2.0, 2),
        round((min_y + max_y) / 2.0, 2),
        round((min_z + max_z) / 2.0, 2),
    )

    return {
        "min": (round(min_x, 2), round(min_y, 2), round(min_z, 2)),
        "max": (round(max_x, 2), round(max_y, 2), round(max_z, 2)),
        "length": length,
        "width": width,
        "height": height,
        "center": center,
    }


def separate_components(triangles, bbox):
    """
    Tách chi tiết lắp ráp: Tách phần Nắp (Lid - z > 80% chiều cao) và Thân (Body - z <= 80%).
    Nếu mô hình không phải hộp nắp, tách thành 2 cụm chi tiết trên/dưới.
    """
    if not triangles:
        return []

    split_z = bbox["min"][2] + bbox["height"] * 0.72

    body_triangles = []
    lid_triangles = []

    for tri in triangles:
        avg_z = (tri["v1"][2] + tri["v2"][2] + tri["v3"][2]) / 3.0
        if avg_z >= split_z:
            lid_triangles.append(tri)
        else:
            body_triangles.append(tri)

    if not lid_triangles or not body_triangles:
        # Nếu không tách được theo z, trả về 1 component duy nhất
        return [
            {
                "id": "part-main",
                "name": "Chi tiết chính (Main Part)",
                "triangles": triangles,
                "color": "#00f3ff",
                "offset_direction": [0.0, 0.0, 0.0],
            }
        ]

    return [
        {
            "id": "part-body",
            "name": "Thân Hộp (Box Body)",
            "triangles": body_triangles,
            "color": "#00f3ff",
            "offset_direction": [0.0, 0.0, -0.3],
        },
        {
            "id": "part-lid",
            "name": "Nắp Trượt (Sliding Lid)",
            "triangles": lid_triangles,
            "color": "#00ff9d",
            "offset_direction": [0.0, 0.0, 1.0],
        },
    ]


def extract_wireframe_mesh(triangles, max_edges=320):
    """Trích xuất khung dây 3D rút gọn (vertices + edges) từ tam giác STL để Canvas render 60 FPS."""
    vertex_map = {}
    vertices = []
    edges_set = set()

    def get_vertex_index(pt):
        # Làm tròn toạ độ 0.5mm để gộp các đỉnh trùng nhau
        key = (round(pt[0], 1), round(pt[1], 1), round(pt[2], 1))
        if key not in vertex_map:
            idx = len(vertices)
            vertex_map[key] = idx
            vertices.append(list(key))
            return idx
        return vertex_map[key]

    # Duyệt tam giác và gom các cạnh
    step = max(1, len(triangles) // 180)
    for i in range(0, len(triangles), step):
        tri = triangles[i]
        i1 = get_vertex_index(tri["v1"])
        i2 = get_vertex_index(tri["v2"])
        i3 = get_vertex_index(tri["v3"])
        for a, b in ((i1, i2), (i2, i3), (i3, i1)):
            if a != b:
                edges_set.add((min(a, b), max(a, b)))
        if len(edges_set) >= max_edges:
            break

    return {"vertices": vertices, "edges": [list(e) for e in sorted(edges_set)]}


def scale_triangles(triangles, target_length=None, target_width=None, target_height=None, scale_x=1.0, scale_y=1.0, scale_z=1.0):
    """Co giãn kích thước lưới tam giác theo kích thước chỉ định hoặc tỷ lệ từng trục."""
    if not triangles:
        return []

    bbox = compute_bounding_box(triangles)
    cur_l = max(0.1, bbox["length"])
    cur_w = max(0.1, bbox["width"])
    cur_h = max(0.1, bbox["height"])

    sx = float(target_length) / cur_l if target_length and target_length > 0 else float(scale_x)
    sy = float(target_width) / cur_w if target_width and target_width > 0 else float(scale_y)
    sz = float(target_height) / cur_h if target_height and target_height > 0 else float(scale_z)

    cx, cy, cz = bbox["center"]

    scaled = []
    for tri in triangles:
        def scale_pt(pt):
            return (
                round(cx + (pt[0] - cx) * sx, 3),
                round(cy + (pt[1] - cy) * sy, 3),
                round(cz + (pt[2] - cz) * sz, 3),
            )

        scaled.append({
            "normal": tri.get("normal", (0.0, 0.0, 1.0)),
            "v1": scale_pt(tri["v1"]),
            "v2": scale_pt(tri["v2"]),
            "v3": scale_pt(tri["v3"]),
        })

    return scaled


def build_parametric_box_triangles(length=58.0, width=34.0, height=24.0, wall=2.0):
    """Sinh lưới tam giác chuẩn của hộp có nắp trượt nếu người dùng chưa có file STL sẵn."""
    l2 = length / 2.0
    w2 = width / 2.0
    h2 = height / 2.0
    lid_h = min(height * 0.28, 6.0)

    triangles = []

    def add_quad(p1, p2, p3, p4, norm):
        triangles.append({"normal": norm, "v1": p1, "v2": p2, "v3": p3})
        triangles.append({"normal": norm, "v1": p1, "v2": p3, "v3": p4})

    # 1. Thân hộp (Box Body)
    body_top = h2 - lid_h
    # Đáy
    add_quad((-l2, -w2, -h2), (l2, -w2, -h2), (l2, w2, -h2), (-l2, w2, -h2), (0, 0, -1))
    # 4 mặt bên
    add_quad((-l2, -w2, -h2), (l2, -w2, -h2), (l2, -w2, body_top), (-l2, -w2, body_top), (0, -1, 0))
    add_quad((l2, -w2, -h2), (l2, w2, -h2), (l2, w2, body_top), (l2, -w2, body_top), (1, 0, 0))
    add_quad((l2, w2, -h2), (-l2, w2, -h2), (-l2, w2, body_top), (l2, w2, body_top), (0, 1, 0))
    add_quad((-l2, w2, -h2), (-l2, -w2, -h2), (-l2, -w2, body_top), (-l2, w2, body_top), (-1, 0, 0))

    # Lòng trong thân hộp
    il2 = max(2.0, l2 - wall)
    iw2 = max(2.0, w2 - wall)
    ibot = -h2 + wall
    add_quad((-il2, -iw2, ibot), (-il2, iw2, ibot), (il2, iw2, ibot), (il2, -iw2, ibot), (0, 0, 1))

    # 2. Nắp trượt (Sliding Lid)
    lid_bot = body_top + 0.4
    lid_top = h2
    add_quad((-l2, -w2, lid_bot), (l2, -w2, lid_bot), (l2, w2, lid_bot), (-l2, w2, lid_bot), (0, 0, -1))
    add_quad((-l2, -w2, lid_top), (-l2, w2, lid_top), (l2, w2, lid_top), (l2, -w2, lid_top), (0, 0, 1))
    add_quad((-l2, -w2, lid_bot), (l2, -w2, lid_bot), (l2, -w2, lid_top), (-l2, -w2, lid_top), (0, -1, 0))
    add_quad((l2, -w2, lid_bot), (l2, w2, lid_bot), (l2, w2, lid_top), (l2, -w2, lid_top), (1, 0, 0))
    add_quad((l2, w2, lid_bot), (-l2, w2, lid_bot), (-l2, w2, lid_top), (l2, w2, lid_top), (0, 1, 0))
    add_quad((-l2, w2, lid_bot), (-l2, -w2, lid_bot), (-l2, -w2, lid_top), (-l2, w2, lid_top), (-1, 0, 0))

    return triangles


def process_cad_model(
    stl_path="",
    output_path="desktop/iris_spatial_edited.stl",
    target_length=None,
    target_width=None,
    target_height=None,
    explode=False,
    explode_distance_mm=38.0,
):
    """Xử lý nạp file CAD 3D, phân tích chi tiết, tách cụm nắp/thân và chỉnh sửa kích thước."""
    t0 = time.perf_counter()

    resolved_stl = _resolve_cad_path(stl_path) if stl_path else ""
    format_type = "parametric_box"

    # 1. Nạp tam giác từ file STL/OBJ hoặc sinh mô hình chuẩn nếu không có file
    if resolved_stl and os.path.isfile(resolved_stl):
        triangles, format_type = load_cad_file(resolved_stl)
        file_name = os.path.basename(resolved_stl)
    else:
        # Fallback tự động kiểm tra iris_spatial_box.stl trên Desktop
        desktop_default = _resolve_cad_path("desktop/iris_spatial_box.stl")
        if os.path.isfile(desktop_default):
            triangles, format_type = load_cad_file(desktop_default)
            resolved_stl = desktop_default
            file_name = os.path.basename(desktop_default)
        else:
            triangles = build_parametric_box_triangles(length=58.0, width=34.0, height=24.0, wall=2.0)
            file_name = "iris_spatial_box.stl"
            resolved_stl = _resolve_cad_path("desktop/iris_spatial_box.stl")

    orig_bbox = compute_bounding_box(triangles)

    # 2. Chỉnh sửa kích thước nếu có yêu cầu (Resize / Dimension Modification)
    is_modified = bool(
        (target_length and abs(target_length - orig_bbox["length"]) > 0.2)
        or (target_width and abs(target_width - orig_bbox["width"]) > 0.2)
        or (target_height and abs(target_height - orig_bbox["height"]) > 0.2)
    )

    if is_modified:
        triangles = scale_triangles(
            triangles,
            target_length=target_length,
            target_width=target_width,
            target_height=target_height,
        )

    current_bbox = compute_bounding_box(triangles)

    # 3. Tách chi tiết lắp ráp (Exploded Assembly)
    components = separate_components(triangles, current_bbox)

    # 4. Ghi file STL đã chỉnh sửa ra ổ đĩa
    target_output = _resolve_cad_path(output_path)
    write_stl_binary(target_output, triangles, header_text=f"Iris Spatial CAD - {file_name}")

    # 5. Xuất khung dây 3D cho từng chi tiết (với offset nổ nếu bật chế độ Explode)
    final_components = []
    for comp in components:
        comp_triangles = comp["triangles"]
        offset_dir = comp.get("offset_direction", [0, 0, 0])
        # Nếu bật explode -> dịch chuyển toạ độ đỉnh của chi tiết theo hướng offset
        effective_offset = [
            offset_dir[0] * (explode_distance_mm if explode else 0.0),
            offset_dir[1] * (explode_distance_mm if explode else 0.0),
            offset_dir[2] * (explode_distance_mm if explode else 0.0),
        ]

        if explode and any(effective_offset):
            comp_triangles_shifted = []
            dx, dy, dz = effective_offset
            for tri in comp_triangles:
                comp_triangles_shifted.append({
                    "normal": tri.get("normal", (0, 0, 1)),
                    "v1": (tri["v1"][0] + dx, tri["v1"][1] + dy, tri["v1"][2] + dz),
                    "v2": (tri["v2"][0] + dx, tri["v2"][1] + dy, tri["v2"][2] + dz),
                    "v3": (tri["v3"][0] + dx, tri["v3"][1] + dy, tri["v3"][2] + dz),
                })
            wireframe = extract_wireframe_mesh(comp_triangles_shifted)
        else:
            wireframe = extract_wireframe_mesh(comp_triangles)

        final_components.append({
            "id": comp["id"],
            "name": comp["name"],
            "color": comp["color"],
            "triangle_count": len(comp_triangles),
            "offset_applied_mm": effective_offset,
            "vertices": wireframe["vertices"],
            "edges": wireframe["edges"],
        })

    elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 2)

    summary_vi = (
        f"Đã mở mô hình 3D [{file_name}] ({current_bbox['length']} × {current_bbox['width']} × {current_bbox['height']} mm). "
        f"{'Đã tách rời các chi tiết (Exploded View: ' + str(round(explode_distance_mm, 1)) + 'mm). ' if explode else ''}"
        f"{'Đã chỉnh sửa kích thước thủ công và lưu lại file .STL.' if is_modified else 'Sẵn sàng kéo chỉnh kích thước trên bàn.'}"
    )

    return {
        "file_name": file_name,
        "input_path": resolved_stl,
        "output_stl_path": target_output,
        "format": format_type,
        "original_dimensions_mm": orig_bbox,
        "current_dimensions_mm": current_bbox,
        "is_modified": is_modified,
        "is_exploded": bool(explode),
        "explode_distance_mm": float(explode_distance_mm),
        "component_count": len(final_components),
        "components": final_components,
        "total_triangles": len(triangles),
        "processing_time_ms": elapsed_ms,
        "summary_vi": summary_vi,
    }


def main():
    parser = _common.ArgParser(description="Mở file CAD 3D, tách cụm chi tiết và chỉnh sửa kích thước trên bàn làm việc.")
    parser.add_argument("--file", default="", help="Đường dẫn file .STL cần mở (nếu rỗng sẽ tự tìm trên Desktop)")
    parser.add_argument("--output", default="desktop/iris_spatial_edited.stl", help="File .STL xuất ra sau khi chỉnh sửa")
    parser.add_argument("--length", type=float, default=None, help="Chiều dài mới (mm, chỉnh sửa thủ công)")
    parser.add_argument("--width", type=float, default=None, help="Chiều rộng mới (mm, chỉnh sửa thủ công)")
    parser.add_argument("--height", type=float, default=None, help="Chiều cao mới (mm, chỉnh sửa thủ công)")
    parser.add_argument("--explode", action="store_true", help="Bật chế độ tách rời các chi tiết lắp ráp (Exploded Assembly View)")
    parser.add_argument("--explode-distance", type=float, default=38.0, help="Khoảng cách tách rời các chi tiết (mm)")

    args = parser.parse_args()
    res = process_cad_model(
        stl_path=args.file,
        output_path=args.output,
        target_length=args.length,
        target_width=args.width,
        target_height=args.height,
        explode=args.explode,
        explode_distance_mm=args.explode_distance,
    )
    _common.emit(True, **res)


if __name__ == "__main__":
    main()
