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


def main():
    if not unreal.load_class(None, '/Script/AL60.AL60GameMode'):
        raise RuntimeError('Build AL60Editor first: native AL60GameMode class is missing')
    editor_assets.make_directory(MATERIAL_DIR)
    editor_assets.make_directory('/Game/Maps')
    make_material('M_AL60_Palette')
    make_material('M_AL60_Unlit', unlit=True)
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
