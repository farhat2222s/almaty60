"""Run inside an already-built Unreal Editor, using -ExecutePythonScript.
Creates only missing AL60 assets. It never replaces an existing map/material.
"""
import os
import unreal

MAP = '/Game/Maps/AL60Prototype'
MATERIAL_DIR = '/Game/Materials'
assets = unreal.AssetToolsHelpers.get_asset_tools()
editor_assets = unreal.EditorAssetLibrary
levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)


def make_material(name, unlit=False):
    asset_path = MATERIAL_DIR + '/' + name
    if editor_assets.does_asset_exist(asset_path):
        unreal.log('AL60 keeps existing material: ' + asset_path)
        return unreal.load_asset(asset_path)
    material = assets.create_asset(name, MATERIAL_DIR, unreal.Material, unreal.MaterialFactoryNew())
    if not material:
        raise RuntimeError('Could not create ' + asset_path)
    material.set_editor_property('two_sided', unlit)
    material.set_editor_property('used_with_instanced_static_meshes', True)
    if unlit:
        material.set_editor_property('shading_model', unreal.MaterialShadingModel.MSM_UNLIT)
    tint = unreal.MaterialEditingLibrary.create_material_expression(material, unreal.MaterialExpressionVectorParameter, -400, 0)
    tint.set_editor_property('parameter_name', 'Tint')
    tint.set_editor_property('default_value', unreal.LinearColor(0.2, 0.4, 0.5, 1.0))
    output = unreal.MaterialProperty.MP_EMISSIVE_COLOR if unlit else unreal.MaterialProperty.MP_BASE_COLOR
    if not unreal.MaterialEditingLibrary.connect_material_property(tint, '', output):
        raise RuntimeError('Could not connect Tint for ' + asset_path)
    if not unlit:
        roughness = unreal.MaterialEditingLibrary.create_material_expression(material, unreal.MaterialExpressionConstant, -400, 180)
        roughness.set_editor_property('r', 0.84)
        unreal.MaterialEditingLibrary.connect_material_property(roughness, '', unreal.MaterialProperty.MP_ROUGHNESS)
    unreal.MaterialEditingLibrary.recompile_material(material)
    editor_assets.save_loaded_asset(material, only_if_is_dirty=False)
    return material


REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
PLAYABLE_ASSETS = os.path.join(REPO, 'Playable', 'public', 'assets')


def import_file(source, destination):
    """Import one file (GLB via Interchange, PNG via texture factory). Returns imported asset paths; never raises."""
    if not os.path.exists(source):
        unreal.log_warning('AL60 source asset missing, skipped: ' + source)
        return []
    if editor_assets.does_directory_exist(destination) and editor_assets.list_assets(destination, recursive=True):
        unreal.log('AL60 keeps existing assets in ' + destination)
        return editor_assets.list_assets(destination, recursive=True)
    try:
        task = unreal.AssetImportTask()
        task.set_editor_property('filename', source)
        task.set_editor_property('destination_path', destination)
        task.set_editor_property('automated', True)
        task.set_editor_property('save', True)
        task.set_editor_property('replace_existing', False)
        assets.import_asset_tasks([task])
        imported = list(task.get_editor_property('imported_object_paths'))
        unreal.log('AL60 imported %d objects from %s' % (len(imported), os.path.basename(source)))
        return imported
    except Exception as error:  # the game code falls back to primitives / palette materials
        unreal.log_warning('AL60 import failed for %s: %s' % (source, error))
        return []


def make_paving_material(texture_path):
    """World-aligned paving: BaseColor = Texture(WorldPosition.xy / 400) * Tint. Kept if it already exists."""
    asset_path = MATERIAL_DIR + '/M_AL60_Paving'
    if editor_assets.does_asset_exist(asset_path):
        unreal.log('AL60 keeps existing material: ' + asset_path)
        return unreal.load_asset(asset_path)
    texture = unreal.load_asset(texture_path) if texture_path and editor_assets.does_asset_exist(texture_path) else None
    if not texture:
        unreal.log_warning('AL60 paving texture missing; palette material stays in use')
        return None
    material = assets.create_asset('M_AL60_Paving', MATERIAL_DIR, unreal.Material, unreal.MaterialFactoryNew())
    material.set_editor_property('used_with_instanced_static_meshes', True)
    lib = unreal.MaterialEditingLibrary
    world_pos = lib.create_material_expression(material, unreal.MaterialExpressionWorldPosition, -1000, 0)
    mask = lib.create_material_expression(material, unreal.MaterialExpressionComponentMask, -800, 0)
    mask.set_editor_property('r', True)
    mask.set_editor_property('g', True)
    mask.set_editor_property('b', False)
    divide = lib.create_material_expression(material, unreal.MaterialExpressionDivide, -620, 0)
    divide.set_editor_property('const_b', 400.0)
    sample = lib.create_material_expression(material, unreal.MaterialExpressionTextureSample, -440, 0)
    sample.set_editor_property('texture', texture)
    tint = lib.create_material_expression(material, unreal.MaterialExpressionVectorParameter, -440, 220)
    tint.set_editor_property('parameter_name', 'Tint')
    tint.set_editor_property('default_value', unreal.LinearColor(1.0, 1.0, 1.0, 1.0))
    multiply = lib.create_material_expression(material, unreal.MaterialExpressionMultiply, -220, 60)
    roughness = lib.create_material_expression(material, unreal.MaterialExpressionConstant, -220, 240)
    roughness.set_editor_property('r', 0.9)
    lib.connect_material_expressions(world_pos, '', mask, '')
    lib.connect_material_expressions(mask, '', divide, 'A')
    lib.connect_material_expressions(divide, '', sample, 'UVs')
    lib.connect_material_expressions(sample, 'RGB', multiply, 'A')
    lib.connect_material_expressions(tint, '', multiply, 'B')
    lib.connect_material_property(multiply, '', unreal.MaterialProperty.MP_BASE_COLOR)
    lib.connect_material_property(roughness, '', unreal.MaterialProperty.MP_ROUGHNESS)
    lib.recompile_material(material)
    editor_assets.save_loaded_asset(material, only_if_is_dirty=False)
    return material


def import_visual_assets():
    """Hero skeletal mesh + clips (Quaternius CC0) and textures from the browser build. All optional."""
    import_file(os.path.join(PLAYABLE_ASSETS, 'models', 'casual-character.glb'), '/Game/Characters/CasualCharacter')
    textures = import_file(os.path.join(PLAYABLE_ASSETS, 'visual-v3', 'arbat-paving-albedo-v3.png'), '/Game/Textures')
    import_file(os.path.join(PLAYABLE_ASSETS, 'visual-v3', 'alatau-panorama-v3.png'), '/Game/Textures')
    paving = next((t for t in textures if 'paving' in t.lower()), None)
    make_paving_material(paving)


def main():
    if not unreal.load_class(None, '/Script/AL60.AL60GameMode'):
        raise RuntimeError('Build AL60Editor first: native AL60GameMode class is missing')
    editor_assets.make_directory(MATERIAL_DIR)
    editor_assets.make_directory('/Game/Maps')
    make_material('M_AL60_Palette')
    make_material('M_AL60_Unlit', unlit=True)
    import_visual_assets()
    if editor_assets.does_asset_exist(MAP):
        unreal.log('AL60 keeps existing map unchanged: ' + MAP)
    else:
        if not levels.new_level(MAP, is_partitioned_world=False):
            raise RuntimeError('Could not create ' + MAP)
        try:
            world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
            world.get_world_settings().set_editor_property('default_game_mode', unreal.load_class(None, '/Script/AL60.AL60GameMode'))
        except Exception as error:  # GlobalDefaultGameMode in DefaultEngine.ini still applies.
            unreal.log_warning('AL60 could not override the level game mode: ' + str(error))
        start = actors.spawn_actor_from_class(unreal.PlayerStart, unreal.Vector(-6150, -350, 120), unreal.Rotator(0, 8, 0))
        start.set_actor_label('AL60_PlayerStart')
        start.set_editor_property('tags', [unreal.Name('AL60Generated')])
        if not levels.save_current_level():
            raise RuntimeError('Could not save ' + MAP)
    unreal.log('AL60_BOOTSTRAP_COMPLETE: procedural city spawns when Play begins')
    if os.environ.get('AL60_BOOTSTRAP_QUIT') == '1':
        unreal.SystemLibrary.quit_editor()


main()
