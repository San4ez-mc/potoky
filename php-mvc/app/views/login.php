<!DOCTYPE html>
<html lang="uk">


<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Вхід — Content Planner Bot</title>
    <link rel="stylesheet" href="/style.css">
    <style>
        body {
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background: linear-gradient(135deg, #5a6c7d 0%, #455562 100%);
         
   font-family: 'Inter', sans-serif;
        }

        .form-box {
            max-width: 420px;
            background: white;
            border-radius: 10px;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);

            padding: 40px;
        }

        .form-box h2 {
            text-align: center;
            color: #2c3e50;
         
   margin-bottom: 24px;
            font-family: 'Poppins', sans-serif;
            font-size: 24px;
        }

        .form-box input {
            width: 100%;
            padding: 10px 12px;
            margin-bottom: 16px;
         
   border: 1px solid #e0e0e0;
            border-radius: 6px;
            font-size: 14px;
            box-sizing: border-box;
        }


        .form-box input:focus {
            outline: none;
            border-color: #5a6c7d;
            box-shadow: 0 0 0 3px rgba(90, 108, 125, 0.08);
        }

        .form-box button {
            width: 100%;
            background: #5a6c7d;
            color: white;
            padding: 10px;
         
   border: none;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 600;
            font-size: 14px;

            transition: all 0.3s;
        }

        .form-box button:hover {
            background: #455562;
         
   transform: translateY(-1px);
        }

        .form-box button.secondary {

            background: #f5f5f7;
            color: #2c3e50;
            border: 1px solid #e0e0e0;
            margin-top: 8px;
        }

        .form-box button.secondary:hover {
            background: #e8e8f0;
        }

       
 .error {
            color: #991b1b;
            background: #fef2f2;
            border: 1px solid #fecaca;
            border-radius: 6px;
        padding: 12px;
            margin-bottom: 16px;
            font-size: 14px;
        }
    </style>
</head>

<body>
    <div class="form-box">
        <h2>🔐 Вхід</h2>
        <?php if (!empty($error)): ?>
       
         <div class="error"><?php echo htmlspecialchars($error); ?></div>
        <?php endif; ?>
        <form method="post" action="/login">
            <input type="text" name="username" placeholder="Логін" required autofocus>
            <input type="password" name="password" placeholder="Пароль" required>
            <button type="submit">Увійти</button>
        </form>
        <form method="post" action="/forgot">
            <button type="submit" class="secondary">Відновити пароль</button>
        </form>
    </div>
</body>

</html>