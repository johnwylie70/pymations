# A real Manim Community script, unchanged. Run it:   pymations run sum_pairing.py
# Share it:   pymations build sum_pairing.py -o sum_pairing.html

from manim import *

# Explainer: 1 + 2 + ... + n by pairing two staircases into an n by (n + 1) rectangle.

N = 5
U = 0.6
STAIR_COL, COPY_COL = BLUE, ORANGE


def staircase(color):
    # Column k (0-based) holds k + 1 unit squares, bottoms aligned.
    cols = VGroup()
    for k in range(N):
        col = VGroup(*[Square(side_length=U) for _ in range(k + 1)]).arrange(UP, buff=0)
        cols.add(col)
    cols.arrange(RIGHT, buff=0, aligned_edge=DOWN)
    cols.set_stroke(WHITE, width=2).set_fill(color, opacity=0.7)
    return cols


class Staircase(Scene):
    def construct(self):
        title = Text("Adding 1 + 2 + ... + n", font_size=40).to_edge(UP)
        self.play(Write(title))

        stair = staircase(STAIR_COL).move_to(LEFT * 2.5 + DOWN * 0.6)
        terms = VGroup(*[MathTex(str(k + 1)).next_to(stair[k], DOWN) for k in range(N)])
        for col, t in zip(stair, terms):
            self.play(LaggedStart(*[FadeIn(sq, shift=DOWN * 0.3) for sq in col], lag_ratio=0.2), FadeIn(t), run_time=0.8)

        s = MathTex("S", "=", "1 + 2 + 3 + 4 + 5").to_edge(RIGHT, buff=0.8)
        self.play(Write(s))
        self.wait(1.5)


class Pairing(Scene):
    def construct(self):
        stair = staircase(STAIR_COL).move_to(LEFT * 2.5 + DOWN * 0.6)
        self.add(stair)

        twin = staircase(COPY_COL).move_to(stair)
        self.play(FadeIn(twin))
        self.play(twin.animate.shift(RIGHT * 4.5))
        self.play(Rotate(twin, PI))
        self.play(twin.animate.next_to(stair[0], UP, buff=0, aligned_edge=LEFT), run_time=1.5)

        rect = VGroup(stair, twin)
        width_brace = Brace(rect, DOWN)
        width_label = MathTex("n").next_to(width_brace, DOWN)
        height_brace = Brace(rect, RIGHT)
        height_label = MathTex("n + 1").next_to(height_brace, RIGHT)
        self.play(GrowFromCenter(width_brace), Write(width_label))
        self.play(GrowFromCenter(height_brace), Write(height_label))

        two_s = MathTex("2S", "=", "n(n+1)").to_edge(RIGHT, buff=0.8).shift(UP * 1.5)
        self.play(Write(two_s))
        self.wait(1.5)


class Formula(MovingCameraScene):
    def construct(self):
        two_s = MathTex("2S", "=", "n(n+1)", font_size=72)
        self.add(two_s)
        self.wait(0.5)
        s = MathTex("S", "=", r"\frac{n(n+1)}{2}", font_size=72)
        self.play(TransformMatchingTex(two_s, s), run_time=1.5)

        check = MathTex("1 + 2 + 3 + 4 + 5", "=", r"\frac{5 \cdot 6}{2}", "=", "15").next_to(s, DOWN, buff=1)
        self.play(Write(check), run_time=2)
        self.play(Indicate(check[4]))
        box = SurroundingRectangle(s, color=YELLOW, buff=0.3)
        self.play(Create(box))
        self.play(self.camera.frame.animate.scale(0.7).move_to(s), run_time=1.5)
        self.wait(1.5)
