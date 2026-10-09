# A real Manim Community script, unchanged. Run it:   pymations run moving_around.py
# Share it:   pymations build moving_around.py -o moving_around.html

from manim import *

# Gallery-style: one square moved, recoloured, scaled and turned with .animate.


class MovingAround(Scene):
    def construct(self):
        square = Square(color=BLUE, fill_opacity=1)

        self.play(square.animate.shift(LEFT))
        self.play(square.animate.set_fill(ORANGE))
        self.play(square.animate.scale(0.3))
        self.play(square.animate.rotate(0.4))
        self.play(square.animate.shift(RIGHT * 3).scale(2))
        self.wait()
