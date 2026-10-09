# A real Manim Community script, unchanged. Run it:   pymations run pythagoras.py
# Share it:   pymations build pythagoras.py -o pythagoras.html

from manim import *

# Explainer: the Pythagorean theorem by rearranging four right triangles inside a square of side a + b.

A_COL, B_COL, C_COL, TRI_COL = BLUE, GREEN, YELLOW, GREY_B
a, b = 1.5, 2.5
s = a + b
x0, y0 = -4.0, -2.4  # bottom-left corner of the big square


def P(x, y):
    return [x0 + x, y0 + y, 0]


def tilted_triangles():
    # Four copies of the (a, b) right triangle in the corners; the hole in the middle is a square of side c.
    return VGroup(
        Polygon(P(0, 0), P(a, 0), P(0, b)),
        Polygon(P(s, 0), P(s, a), P(a, 0)),
        Polygon(P(s, s), P(b, s), P(s, a)),
        Polygon(P(0, s), P(0, b), P(b, s)),
    ).set_fill(TRI_COL, opacity=0.85).set_stroke(WHITE, width=2)


def paired_triangles():
    # The same four triangles as two a-by-b rectangles; the holes are squares of side a and b.
    return VGroup(
        Polygon(P(a, 0), P(s, 0), P(s, a)),
        Polygon(P(a, a), P(a, 0), P(s, a)),
        Polygon(P(0, a), P(a, a), P(0, s)),
        Polygon(P(a, s), P(0, s), P(a, a)),
    ).set_fill(TRI_COL, opacity=0.85).set_stroke(WHITE, width=2)


def frame():
    return Square(side_length=s, color=WHITE).move_to(P(s / 2, s / 2))


class Setup(Scene):
    def construct(self):
        title = Text("Pythagoras by rearrangement", font_size=40).to_edge(UP)
        self.play(Write(title))

        tri = Polygon([-2.5, -1.2, 0], [1.5, -1.2, 0], [-2.5, 1.2, 0], color=WHITE, fill_color=TRI_COL, fill_opacity=0.85)
        la = MathTex("a", color=A_COL).next_to(tri, LEFT)
        lb = MathTex("b", color=B_COL).next_to(tri, DOWN)
        lc = MathTex("c", color=C_COL).move_to([-0.2, 0.4, 0])
        self.play(DrawBorderThenFill(tri))
        self.play(LaggedStart(Write(la), Write(lb), Write(lc), lag_ratio=0.3))
        self.wait()

        claim = MathTex("a^2", "+", "b^2", "=", "c^2", font_size=60).next_to(tri, DOWN, buff=0.9)
        claim[0].set_color(A_COL)
        claim[2].set_color(B_COL)
        claim[4].set_color(C_COL)
        self.play(Write(claim))
        self.wait()
        self.play(FadeOut(tri, la, lb, lc, claim, title))


class TiltedSquare(Scene):
    def construct(self):
        big = frame()
        tris = tilted_triangles()
        self.play(Create(big))
        self.play(LaggedStart(*[DrawBorderThenFill(t) for t in tris], lag_ratio=0.25), run_time=2.5)

        hole = Polygon(P(a, 0), P(s, a), P(b, s), P(0, b), stroke_width=0, fill_color=C_COL, fill_opacity=0.6)
        c2 = MathTex("c^2", color=C_COL, font_size=60).move_to(P(s / 2, s / 2))
        self.play(FadeIn(hole), Write(c2))

        note = MathTex(r"\text{area} = ", "c^2", r"+ 4 \cdot \tfrac{1}{2}ab").to_edge(RIGHT, buff=0.8)
        note[1].set_color(C_COL)
        self.play(Write(note))
        self.wait(2)


class Rearranged(Scene):
    def construct(self):
        big = frame()
        tris = tilted_triangles()
        self.add(big, tris)
        self.wait(0.5)

        self.play(*[Transform(t, u) for t, u in zip(tris, paired_triangles())], run_time=3)

        sq_a = Square(side_length=a, stroke_width=0, fill_color=A_COL, fill_opacity=0.6).move_to(P(a / 2, a / 2))
        sq_b = Square(side_length=b, stroke_width=0, fill_color=B_COL, fill_opacity=0.6).move_to(P(a + b / 2, a + b / 2))
        la = MathTex("a^2", font_size=48).move_to(sq_a)
        lb = MathTex("b^2", font_size=60).move_to(sq_b)
        self.play(FadeIn(sq_a), FadeIn(sq_b), Write(la), Write(lb))

        note = MathTex(r"\text{area} = ", "a^2", "+", "b^2", r"+ 4 \cdot \tfrac{1}{2}ab").to_edge(RIGHT, buff=0.8)
        note[1].set_color(A_COL)
        note[3].set_color(B_COL)
        self.play(Write(note))
        self.wait(2)


class Conclusion(MovingCameraScene):
    def construct(self):
        same = MathTex("c^2", r"+ 4 \cdot \tfrac{1}{2}ab", "=", "a^2", "+", "b^2", r"+ 4 \cdot \tfrac{1}{2}ab")
        same[0].set_color(C_COL)
        same[3].set_color(A_COL)
        same[5].set_color(B_COL)
        self.play(Write(same))
        self.wait()

        result = MathTex("c^2", "=", "a^2", "+", "b^2", font_size=72)
        result[0].set_color(C_COL)
        result[2].set_color(A_COL)
        result[4].set_color(B_COL)
        self.play(TransformMatchingTex(same, result), run_time=2)
        box = SurroundingRectangle(result, color=YELLOW, buff=0.25)
        self.play(Create(box))
        self.play(self.camera.frame.animate.scale(0.7).move_to(result), run_time=2)
        self.wait(2)
