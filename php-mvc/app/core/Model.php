<?php
// app/core/Model.php
class Model
{
    protected $db;
    public function __construct($db)
    {
        $this->db = $db;
    }
}
