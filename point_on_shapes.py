# A real Manim Community script, unchanged. Run it:   pymations run point_on_shapes.py
# Share it:   pymations build point_on_shapes.py -o point_on_shapes.html

from manim import *

# Gallery-style: a dot grows, rides round a circle, is turned about a point, and the circle becomes a square.


class PointMovingOnShapes(Scene):
    def construct(self):
        circle = Circle(radius=1, color=BLUE)
        dot = Dot()
        dot2 = dot.copy().shift(RIGHT)
        self.add(dot)

        line = Line([3, 0, 0], [5, 0, 0])
        self.add(line)

        self.play(GrowFromCenter(circle))
        self.play(Transform(dot, dot2))
        self.play(MoveAlongPath(dot, circle), run_time=2, rate_func=linear)
        self.play(Rotate(dot, about_point=[2, 0, 0]), run_time=1.5)
        self.play(Transform(circle, Square(color=TEAL)))
        self.wait()
