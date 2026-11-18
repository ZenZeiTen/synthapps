"""Mutation check for the Godot transcript runner (twin of tests/mutation.mjs).

Injects faults into godot/scripts/core.gd one at a time, runs the headless
transcript runner, and confirms each fault turns it red. The file is always
restored, even if the run is interrupted.

    python tests/mutation_godot.py
"""
import os, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORE = os.path.join(ROOT, 'godot', 'scripts', 'core.gd')
GODOT = os.environ.get('GODOT', os.path.join(os.path.expanduser('~'), 'Downloads', 'Godot_v4.7.2-stable_win64.exe', 'Godot_v4.7.2-stable_win64_console.exe'))

MUTANTS = [
    ('reach check always passes', 'return dx * dx + dy * dy <= 1.0', 'return true'),
    ('take prefers carried objects', 'if verb == "take" and here.size() > 0:\n\t\treturn {"id": here[0]}', 'if false:\n\t\treturn {"id": here[0]}'),
    ('score awarded repeatedly', 'if state["awarded"].has(id):\n\t\treturn', 'if false:\n\t\treturn'),
    ('exit condition ignored', 'if not check(state, x.get("when")):\n\t\tif x.get("silent", false):', 'if false:\n\t\tif x.get("silent", false):'),
    ('fillers not removed', 'if fill.has(t):\n\t\t\tcontinue', 'if false:\n\t\t\tcontinue'),
]


def run():
    # --quit-after: a script error inside _init aborts before quit(), and the idle
    # SceneTree would otherwise run forever. The summary line is the only proof the
    # run finished: a crash that never prints it is a failure, never a pass.
    p = subprocess.run([GODOT, '--headless', '--quit-after', '900', '--path', os.path.join(ROOT, 'godot'),
                        '--script', 'res://tests/run_transcripts.gd'], capture_output=True, text=True, timeout=240)
    out = p.stdout.splitlines()
    fails = [l.split(' ', 1)[1] for l in out if l.startswith('FAIL ')]
    summary = [l for l in out if l.endswith(' failed') and ' transcripts, ' in l]
    if not summary:
        return 1, fails + ['<crashed before the summary line>']
    return (0 if summary[-1].endswith(' 0 failed') and p.returncode == 0 else 1), fails


original = open(CORE, encoding='utf-8').read()
backup = CORE + '.bak'
shutil.copyfile(CORE, backup)
survivors = 0
try:
    code, fails = run()
    if code != 0:
        sys.exit(f'baseline failing: {fails}')
    print('baseline: all transcripts pass\n')
    for name, find, repl in MUTANTS:
        n = original.count(find)
        if n != 1:
            print(f'?? {name}: anchor found {n}x -- fix this script'); survivors += 1; continue
        open(CORE, 'w', encoding='utf-8', newline='\n').write(original.replace(find, repl))
        code, fails = run()
        if code != 0 and fails:
            print(f'caught   {name:32s} by {", ".join(fails)}')
        else:
            print(f'SURVIVED {name}'); survivors += 1
finally:
    shutil.copyfile(backup, CORE)
    os.remove(backup)
print(f'\n{len(MUTANTS) - survivors}/{len(MUTANTS)} mutants caught')
sys.exit(1 if survivors else 0)
