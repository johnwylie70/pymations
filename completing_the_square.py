# A real Manim Community script, unchanged. Run it:   pymations run completing_the_square.py
# Share it:   pymations build completing_the_square.py -o completing_the_square.html

from manim import *

# Explainer: completing the square for x^2 + 6x, first as algebra, then as a picture.

X, H = 2.8, 1.1  # side x, and half of b (b = 6 shown as 2 * 3; drawn as 2 * H)
X_COL, B_COL, FILL_COL = BLUE, ORANGE, YELLOW
ORIGIN_PT = [-5.0, -2.2, 0]


def pt(x, y):
    return [ORIGIN_PT[0] + x, ORIGIN_PT[1] + y, 0]


def x_square():
    return Square(side_length=X, color=X_COL, fill_opacity=0.5).move_to(pt(X / 2, X / 2))


class Algebra(Scene):
    def construct(self):
        title = Text("Completing the square", font_size=40).to_edge(UP)
        self.play(Write(title))

        e1 = MathTex("x^2", "+", "6x", font_size=72)
        self.play(Write(e1))
        self.wait()
        e2 = MathTex("x^2", "+", "3x", "+", "3x", font_size=72)
        self.play(TransformMatchingTex(e1, e2))
        self.wait()
        e3 = MathTex("x^2", "+", "3x", "+", "3x", "+", "9", "-", "9", font_size=72)
        self.play(TransformMatchingTex(e2, e3))
        self.wait()
        e4 = MathTex("(x+3)^2", "-", "9", font_size=72)
        self.play(TransformMatchingTex(e3, e4), run_time=1.5)
        self.play(Circumscribe(e4[0]))
        self.wait()


class Picture(Scene):
    def construct(self):
        sq = x_square()
        sq_label = MathTex("x^2").move_to(sq)
        rect = Rectangle(width=2 * H, height=X, color=B_COL, fill_opacity=0.5).next_to(sq, RIGHT, buff=0)
        rect_label = MathTex("6x").move_to(rect)
        self.play(DrawBorderThenFill(sq), Write(sq_label))
        self.play(DrawBorderThenFill(rect), Write(rect_label))
        self.wait()

        halves = VGroup(
            Rectangle(width=H, height=X, color=B_COL, fill_opacity=0.5),
            Rectangle(width=H, height=X, color=B_COL, fill_opacity=0.5),
        ).arrange(RIGHT, buff=0).move_to(rect)
        labels = VGroup(MathTex("3x").move_to(halves[0]), MathTex("3x").move_to(halves[1]))
        self.play(ReplacementTransform(rect, halves), ReplacementTransform(rect_label, labels))
        self.wait(0.5)

        # Turn the second half on its side and stack it on top of the square.
        self.play(
            Rotate(halves[1], -PI / 2),
            FadeOut(labels[1]),
        )
        self.play(halves[1].animate.next_to(sq, UP, buff=0))
        top_label = MathTex("3x").move_to(halves[1])
        self.play(FadeIn(top_label))

        corner = Square(side_length=H, color=FILL_COL, fill_opacity=0.0).next_to(halves[1], RIGHT, buff=0)
        self.play(Create(corner))
        q = MathTex("?", color=FILL_COL).move_to(corner)
        self.play(Write(q))
        self.wait(1.5)


class Complete(MovingCameraScene):
    def construct(self):
        sq = x_square()
        right = Rectangle(width=H, height=X, color=B_COL, fill_opacity=0.5).next_to(sq, RIGHT, buff=0)
        top = Rectangle(width=X, height=H, color=B_COL, fill_opacity=0.5).next_to(sq, UP, buff=0)
        corner = Square(side_length=H, color=FILL_COL).next_to(top, RIGHT, buff=0)
        labels = VGroup(MathTex("x^2").move_to(sq), MathTex("3x").move_to(right), MathTex("3x").move_to(top))
        self.add(sq, right, top, corner, labels)

        self.play(corner.animate.set_fill(FILL_COL, opacity=0.8))
        nine = MathTex("9").move_to(corner)
        self.play(Write(nine))

        whole = VGroup(sq, right, top, corner, labels)
        brace = Brace(whole, DOWN)
        side = MathTex("x + 3").next_to(brace, DOWN)
        self.play(GrowFromCenter(brace), Write(side))

        eq = MathTex("x^2", "+", "6x", "+", "9", "=", "(x+3)^2", font_size=60).to_edge(RIGHT, buff=0.6)
        eq[4].set_color(FILL_COL)
        self.play(Write(eq), run_time=2)
        self.play(self.camera.frame.animate.scale(0.6).move_to(eq), run_time=2)
        self.play(Circumscribe(eq[6], color=FILL_COL))
        self.wait(1.5)
