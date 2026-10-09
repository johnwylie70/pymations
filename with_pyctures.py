# Mixing with Pyctures drawing: a draw() function paints a twinkling
# background with ctx every frame, and the animation plays on top of it.
# Run it:   pymations run with_pyctures.py

import math, random
from pymations import *

stars = [(random.random(), random.random(), random.uniform(0, math.tau)) for _ in range(150)]
clock = 0.0


def draw():
    global clock
    clock += 1 / 60
    ctx.fill_style = "#0b1020"
    ctx.fill_rect(0, 0, width, height)
    for x, y, phase in stars:
        a = 0.35 + 0.35 * math.sin(clock * 2 + phase)
        ctx.fill_style = f"rgba(255, 255, 255, {a:.2f})"
        ctx.fill_rect(x * width, y * height, 2, 2)


ring = Circle(radius=2, color=YELLOW)
label = Text("Pyctures + Pymations", font_size=36).next_to(ring, DOWN)
play(Create(ring), Write(label))
play(Rotate(ring, angle=PI))
play(ring.animate.scale(0.5).set_color(TEAL))
wait()
