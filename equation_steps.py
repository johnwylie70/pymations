# Solving an equation one step at a time. Parts with the same TeX move to
# their new places; the rest fade.
# Run it:   pymations run equation_steps.py

from pymations import *

steps = [
    MathTex("2x", "+", "3", "=", "11"),
    MathTex("2x", "=", "11", "-", "3"),
    MathTex("2x", "=", "8"),
    MathTex("x", "=", "4"),
]
for step in steps:
    step.scale(1.5)

title = Text("Solve for x", font_size=40).to_edge(UP)
play(FadeIn(title))
play(Write(steps[0]))
wait(0.5)
for before, after in zip(steps, steps[1:]):
    play(TransformMatchingTex(before, after))
    wait(0.5)
play(Circumscribe(steps[-1], color=YELLOW))
wait()
