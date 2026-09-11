"""UE Editor import of the exact exported OSM polygons and road centerlines.

Enable Python Editor Script Plugin, Editor Scripting Utilities and Geometry Script.
Execute inside UE 5.6 Editor Python console:
  exec(open('/absolute/path/Geo/ue-import/import_district.py').read())
  import_district('/absolute/path/Geo/exports/district-local.json')

Creates NEW DynamicMeshActors in an AL60_OSM_* folder; does not delete actors or
save/overwrite the current level. This script has syntax/data checks but has not
been executed in Unreal in this environment. Default/level-derived heights and
road widths are visualization assumptions, not surveyed geometry.
"""
import json
import math
from datetime import datetime, timezone


def polygon_ccw(points):
    ring = [(float(p[0]) * 100, float(p[1]) * 100) for p in points]
    if len(ring) > 1 and ring[0] == ring[-1]:
        ring.pop()
    if len(ring) < 3:
        raise ValueError("Polygon has fewer than three vertices")
    signed_area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:] + ring[:1]))
    if abs(signed_area) < .001:
        raise ValueError("Degenerate polygon")
    return ring if signed_area > 0 else list(reversed(ring))


def road_rectangles(points, width_meters):
    result = []
    half = width_meters / 2
    for a, b in zip(points, points[1:]):
        dx, dz = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dz)
        if length < .01:
            continue
        nx, nz = -dz / length * half, dx / length * half
        result.append([[a[0]+nx,a[1]+nz,0],[b[0]+nx,b[1]+nz,0],
                       [b[0]-nx,b[1]-nz,0],[a[0]-nx,a[1]-nz,0]])
    return result


def import_district(json_path, max_features=2000, collision=True):
    import unreal
    with open(json_path, encoding="utf-8") as stream:
        district = json.load(stream)
    if district.get("type") != "AL60LocalFeatureCollection":
        raise ValueError("Use district-local.json, not degree-based GeoJSON")
    if len(district["features"]) > max_features:
        raise ValueError("Too many features for a single editor import")
    for name in ("DynamicMeshActor", "GeometryScript_Primitives", "EditorActorSubsystem"):
        if not hasattr(unreal, name):
            raise RuntimeError("Missing UE class/plugin: " + name)
    editor = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    folder = "AL60_OSM_" + datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    primitive_options = unreal.GeometryScriptPrimitiveOptions()
    created, skipped = [], []
    with unreal.ScopedEditorTransaction("Import licensed ALMATY 60 OSM district"):
        for feature in district["features"]:
            prop, geom = feature["properties"], feature["geometry"]
            kind = prop["kind"]
            if kind == "poi":
                continue
            polygons = []
            if geom["type"] == "Polygon" and kind in ("building", "plaza", "green"):
                if len(geom["coordinates"]) != 1:
                    skipped.append(feature["id"] + ": holes need a triangulation-aware importer")
                    continue
                polygons = [geom["coordinates"][0]]
            elif kind == "road":
                paths = [geom["coordinates"]] if geom["type"] == "LineString" else geom["coordinates"]
                tags = prop.get("tags", {})
                try:
                    width = float(str(tags.get("width", "")).split()[0])
                except (ValueError, IndexError):
                    width = 10 if tags.get("highway") == "pedestrian" else 2.2 if tags.get("highway") in ("footway", "path", "steps") else 7
                width = min(30, max(.5, width))
                polygons = [ring for line in paths for ring in road_rectangles(line, width)]
            if not polygons:
                continue
            try:
                converted = [polygon_ccw(ring) for ring in polygons]
            except ValueError as error:
                skipped.append(feature["id"] + ": " + str(error))
                continue
            actor = editor.spawn_actor_from_class(unreal.DynamicMeshActor, unreal.Vector(0, 0, 0))
            actor.set_actor_label("OSM_" + feature["id"].replace(":", "_").replace("/", "_") + "_" + (prop.get("name") or kind))
            actor.set_folder_path(folder)
            actor.set_editor_property("tags", ["AL60_OSM", kind, feature["id"], "ODbL-1.0"])
            component = actor.get_dynamic_mesh_component()
            mesh = component.get_dynamic_mesh()
            for ring in converted:
                vertices = [unreal.Vector2D(x, y) for x, y in ring]
                if kind == "building":
                    height = float(prop.get("heightMeters", 9)) * 100
                    unreal.GeometryScript_Primitives.append_simple_extrude_polygon(
                        mesh, primitive_options, unreal.Transform(), vertices,
                        height=height, capped=True,
                        origin=unreal.GeometryScriptPrimitiveOriginMode.BASE)
                else:
                    # Flat source footprints, slightly separated to prevent z-fighting.
                    transform = unreal.Transform(location=unreal.Vector(0, 0, 2 if kind == "road" else 1))
                    unreal.GeometryScript_Primitives.append_triangulated_polygon(
                        mesh, primitive_options, transform, vertices, allow_self_intersections=False)
            if collision:
                component.set_complex_as_simple_collision_enabled(True, True)
                component.set_collision_enabled(unreal.CollisionEnabled.QUERY_AND_PHYSICS)
                component.set_collision_profile_name("BlockAll")
            created.append(actor)
    unreal.log("ALMATY 60 OSM import: %d actors, %d skipped; © OpenStreetMap contributors / ODbL. Level not saved." % (len(created), len(skipped)))
    for message in skipped:
        unreal.log_warning(message)
    return created
